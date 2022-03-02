---
layout: post
title: "goleveldb中Cache的实现原理"
date: 2022-02-11
tag:
- golang
- leveldb
comments: false
---

# goleveldb缓冲的设计与实现

Cache作为数据库非常重要的组件，可以加快数据的访问；也需要支持并发访问。Cache用于缓冲sstable的dataBlock的内容；

leveldb的Cacher能力由Cache和lru两个结构体共同实现：

+ Cache是哈希表实现的，负责数据的存储以及扩缩容。内部实现为：将数据分别存储在不同的bucket下，每个bucket存储真正的数据节点Node
+ lru负责维护数据的顺序，每个lruNode和Cache中的Node结点之间一一对应。lru实现了标准的Cacher接口，所以lru是可拔插的，

Cache的实现原理为动态非阻塞哈希表。这里的非阻塞体现在不会阻塞其他buckets的操作。

LRUCache，顾名思义，就是基于Least Recently Used原理实现了Cacher接口。

Cache和LRUCacher二者的关系：
Cache：用来存储数据的缓冲；LRUCacher用来维护缓冲中数据的顺序（新旧程度）
Cache和LRUCache提供了相同的接口Cacher，Cache复用了LRUCache的一部分能力

## 核心结构体定义

+ Node：cache Node；与Cache(r)进行关联; 通过CacheData与lruData进行关联
+ Bucket：Node列表
+ mNode：包含Bucket数组
+ Cache：cache map; 包含mNode头节点；cacher，lru cache

lru结构体定义：

``` golang
type lru struct {
    mu       sync.Mutex
    capacity int
    used     int
    recent   lruNode // 头节点
}
```

lruNode：构成双链表；直接引用buckets中的Node指针，形成一一对应关系

``` go
type lruNode struct {
    n   *Node
    h   *Handle
    ban bool

    next, prev *lruNode
}
```

lruNode的handle对象是Cache Node的Cache handle；负责管理Node的引用计数

## 安全性（加锁粒度）

Cache整体结构实际上是多个bucket数组，每个bucket是Node数组。因此整体的加锁粒度分为两层：
+ Cache: 使用RWMutex
  + mHead(mNode): mNode组成单链表，一个节点
    + buckets([]mBucket): bucket列表，mBucket有独立的Mutex(用于bucket扩容、缩容)
      + node([]Node): 每个bucket由Node列表组成，Node有独立的Mutex

> 使用指针来共享数据，避免内存空间重复分配。

### Cache如何扩容和缩容

调用mBucket.get方法时，进行判断是否需要扩容。如果需要，新增一个mNode节点，buckets数据是当前bucket节点node数量的两倍，然后将新节点作为cache的mhead节点；同时，将原节点数据保存在pred字段中。

``` golang
func (n *mNode) initBucket(i uint32) *mBucket {
	if b := (*mBucket)(atomic.LoadPointer(&n.buckets[i])); b != nil {
		return b
	}

	p := (*mNode)(atomic.LoadPointer(&n.pred))
	if p != nil {
		var node []*Node
		if n.mask > p.mask {
			// Grow.
			// 从buckets找到一个有效的bucket
			pb := (*mBucket)(atomic.LoadPointer(&p.buckets[i&p.mask]))
			if pb == nil {
				pb = p.initBucket(i & p.mask)
			}
			m := pb.freeze()
			// Split nodes.
			for _, x := range m {
				// 将数据hash到新的buckets
				if x.hash&n.mask == i {
					node = append(node, x)
				}
			}
		} else {
			// Shrink.
			pb0 := (*mBucket)(atomic.LoadPointer(&p.buckets[i]))
			if pb0 == nil {
				pb0 = p.initBucket(i)
			}
			pb1 := (*mBucket)(atomic.LoadPointer(&p.buckets[i+uint32(len(n.buckets))]))
			if pb1 == nil {
				pb1 = p.initBucket(i + uint32(len(n.buckets)))
			}
			m0 := pb0.freeze()
			m1 := pb1.freeze()
			// Merge nodes.
			node = make([]*Node, 0, len(m0)+len(m1))
			node = append(node, m0...)
			node = append(node, m1...)
		}
		b := &mBucket{node: node}
		if atomic.CompareAndSwapPointer(&n.buckets[i], nil, unsafe.Pointer(b)) {
			if len(node) > mOverflowThreshold {
				atomic.AddInt32(&n.overflow, int32(len(node)-mOverflowThreshold))
			}
			return b
		}
	}
	// 默认返回空的 mbucket
	return (*mBucket)(atomic.LoadPointer(&n.buckets[i]))
}
```

在扩容或缩容时，需要进行rehash操作，首先定位到需要hash的bucket，将bucket.freeze状态置为true，获取当前bucket上新的node列表，通过CAS来进行无锁操作（更新变量的地址）。这种操作方式比直接加锁的开销要小。

在什么情况会进行扩容：

+ growThreshold为当前bucket数量乘以OverflowThreshold；
+ 单个bucket的节点数量超过mOverflowThreshold(默认为32)，且整体buckets的overflow总量大于mOverflowGrowThreshold(默认为128)

在什么情况会进行缩容：

+ Cacher中节点数量少于shrinkThreshold时，shrinkThreshold为当前bucket数量的一半；

leveldb Cache层对外暴露的初始化接口：
``` go
func NewCache(cacher Cacher) *Cache {
	h := &mNode{
		buckets:         make([]unsafe.Pointer, mInitialSize),
		mask:            mInitialSize - 1,
		growThreshold:   int32(mInitialSize * mOverflowThreshold),
		shrinkThreshold: 0,
	}
	for i := range h.buckets {
		h.buckets[i] = unsafe.Pointer(&mBucket{})
	}
	r := &Cache{
		mHead:  unsafe.Pointer(h),
		cacher: cacher,
	}
	return r
}
```

## Cacher接口能力

Cacher interface定义：
```
// Cacher provides interface to implements a caching functionality.
// An implementation must be safe for concurrent use.
type Cacher interface {
	// Capacity returns cache capacity.
	Capacity() int

	// SetCapacity sets cache capacity.
	SetCapacity(capacity int)

	// Promote promotes the 'cache node'.
	Promote(n *Node)

	// Ban evicts the 'cache node' and prevent subsequent 'promote'.
	Ban(n *Node)

	// Evict evicts the 'cache node'.
	Evict(n *Node)

	// EvictNS evicts 'cache node' with the given namespace.
	EvictNS(ns uint64)

	// EvictAll evicts all 'cache node'.
	EvictAll()

	// Close closes the 'cache tree'
	Close() error
}
```

### 动态哈希表和LRU缓冲如何构成Cache

## 扩展

### `sync.Map`的实现

设计哲学：使用read、dirty两个map来存储数据，read用来读取，dirty用来更新；当miss次数超过阈值时，dirty升级为read

```
type Map struct {
	mu Mutex

	read atomic.Value // readOnly
	dirty map[interface{}]*entry
	misses int
}
```

miss字段标记了某些key不在m.read的次数。
当miss次数大于m.dirty的键值对数量时，m.dirty提升为m.read。

读取数据，优先从read读取数据，如果不存在，继续在dirty中查找。

添加新数据，只往m.dirty中添加entry。如果m.dirty为空的话，需要将m.read的数据复制到m.dirty中。

更新操作，先在m.read中寻找，然后在m.dirty中寻找，找到即更新;否则添加新数据.如果m.dirty有新数据时，会将值为nil的entry更新为expunged标记。

删除操作，如果entry不存在m.read中，并且m.dirty有新数据，那么直接在dirty上删除；如果entry存在m.read中，将entry进行标记删除，`p==nil`。

Entry的定义
```
// An entry is a slot in the map corresponding to a particular key.
type entry struct {
	// p points to the interface{} value stored for the entry.
	//
	// If p == nil, the entry has been deleted and m.dirty == nil.
	//
	// If p == expunged, the entry has been deleted, m.dirty != nil, and the entry
	// is missing from m.dirty.
	//
	// Otherwise, the entry is valid and recorded in m.read.m[key] and, if m.dirty
	// != nil, in m.dirty[key].
	//
	// An entry can be deleted by atomic replacement with nil: when m.dirty is
	// next created, it will atomically replace nil with expunged and leave
	// m.dirty[key] unset.
	//
	// An entry's associated value can be updated by atomic replacement, provided
	// p != expunged. If p == expunged, an entry's associated value can be updated
	// only after first setting m.dirty[key] = e so that lookups using the dirty
	// map find the entry.
	p unsafe.Pointer // *interface{}
}
```

Entry的p指针使用atomic进行原子操作

sync.Pool的设计哲学：将缓冲池的数据poolLocal与调度器P进行绑定，每个线程从关联的P所拥有的poolLocal获取数据，从而降低了锁竞争。

PoolLocal拥有自己的private、shared存储空间：
+ private: 仅能被对应的P所使用
+ shared：双端队列实现

### redis中hash的实现

## 参考

1. Dynamic-sized nonblocking hash tables
2. [leveldb-handbook](https://leveldb-handbook.readthedocs.io/zh/latest/index.html)
3. [leveldb中的LRUCache设计](https://bean-li.github.io/leveldb-LRUCache/)
4. [Go 1.9 sync.Map揭秘](https://colobu.com/2017/07/11/dive-into-sync-Map/)