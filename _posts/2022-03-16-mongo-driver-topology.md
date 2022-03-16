---
layout: post
title: "mongo-go-driver中topology的实现"
date: 2022-03-16
tag:
- mongoDB
comments: false
---

topology模块是driver最重要的模块之一，该模块用来维护mongodb数据库的Deployment，以及每个Server的状态和Connection pool。

topology模块下有Topology、Server、Connection、Pool核心类型:

+ Topology：负责监控MongoDB的部署状态，并通过server selection算法来选择Server。并通过FSM更新server description，FSM实现了服务发现和监控能力。
+ Server：负责与MongoDB server建立heartbeating，并维护连接池
+ Pool：连接池，用来缓冲idle连接和创建新的连接。

## Topology实体

Topology实体提供的能力：

+ 维护MongoDB集群的部署状态Topology Description，对外暴露Deployment接口。
+ Topology与MongoDB集群的连接状态
+ 维护了Topology与使用方(session)之间的订阅关系，实现了Subscriber接口
+ 支持在`uri.schema=mongodb+srv && loadBalanced=false`状态下定期通过DnsResolver来pullSrvRecords
+ 维护了服务地址和对应Server之间的关系
+ 通过ServerMonitor回调函数提供了监控拓扑以及Server相关事件的变化情况，共有8类回调函数

Topology实现了Subscriber接口，可以订阅topology description的变更。在session中用到了该接口，来获取最新的Topology信息。

```
// 接口定义
type Subscriber interface {
   Subscribe() (*Subscription, error)
   Unsubscribe(*Subscription) error
}
```

Topology实现了Deployment接口，具体定义如下：

```
// Deployment is implemented by types that can select a server from a deployment.
type Deployment interface {
   SelectServer(context.Context, description.ServerSelector) (Server, error)
   Kind() description.TopologyKind
}

// TopologyKind represents a specific topology configuration.
type TopologyKind uint32

// These constants are the available topology configurations.
const (
   Single                TopologyKind = 1
   ReplicaSet            TopologyKind = 2
   ReplicaSetNoPrimary   TopologyKind = 4 + ReplicaSet
   ReplicaSetWithPrimary TopologyKind = 8 + ReplicaSet
   Sharded               TopologyKind = 256
   LoadBalanced          TopologyKind = 512
)

```

最核心的接口是SelectServer，在给定的超时时间下，通过ServerSelector算法来选择一个Server。具体逻辑如下：

+ 对于第一轮，从当前的description中选择一个server，加快从最新的topology中选择server的速度
+ 对于后续的轮询，通过Subscribe接口来获取最新的Topology，从而进行server选择

```
// SelectServer selects a server with given a selector. SelectServer complies with the
// server selection spec, and will time out after severSelectionTimeout or when the
// parent context is done.
func (t *Topology) SelectServer(ctx context.Context, ss description.ServerSelector) (driver.Server, error) {
	if atomic.LoadInt64(&t.connectionstate) != connected {
		return nil, ErrTopologyClosed
	}
	var ssTimeoutCh <-chan time.Time

	if t.cfg.serverSelectionTimeout > 0 {
		ssTimeout := time.NewTimer(t.cfg.serverSelectionTimeout)
		ssTimeoutCh = ssTimeout.C
		defer ssTimeout.Stop()
	}

	var doneOnce bool
	var sub *driver.Subscription
	selectionState := newServerSelectionState(ss, ssTimeoutCh)
	for {
		var suitable []description.Server
		var selectErr error

		if !doneOnce {
			// for the first pass, select a server from the current description.
			// this improves selection speed for up-to-date topology descriptions.
			suitable, selectErr = t.selectServerFromDescription(t.Description(), selectionState)
			doneOnce = true
		} else {
			// if the first pass didn't select a server, the previous description did not contain a suitable server, so
			// we subscribe to the topology and attempt to obtain a server from that subscription
			if sub == nil {
				var err error
				sub, err = t.Subscribe()
				if err != nil {
					return nil, err
				}
				defer t.Unsubscribe(sub)
			}

			suitable, selectErr = t.selectServerFromSubscription(ctx, sub.Updates, selectionState)
		}
		if selectErr != nil {
			return nil, selectErr
		}

		if len(suitable) == 0 {
			// try again if there are no servers available
			continue
		}

		selected := suitable[random.Intn(len(suitable))]
		selectedS, err := t.FindServer(selected)
		switch {
		case err != nil:
			return nil, err
		case selectedS != nil:
			return selectedS, nil
		default:
			// We don't have an actual server for the provided description.
			// This could happen for a number of reasons, including that the
			// server has since stopped being a part of this topology, or that
			// the server selector returned no suitable servers.
		}
	}
}
```

对于Topology中Server Addr来源有：

+ 在cfg.seedList中配置
+ 在cfg.uri中配置

基于Server Addr列表维护对应的Server状态，并更新FSM中的Topology的Server列表

### FSM

```
type fsm struct {
	description.Topology
	maxElectionID    primitive.ObjectID
	maxSetVersion    uint32
	compatible       atomic.Value
	compatibilityErr error
}

// description/topology.go
// Topology contains information about a MongoDB cluster.
type Topology struct {
   Servers               []Server
   SetName               string
   Kind                  TopologyKind
   SessionTimeoutMinutes uint32
   CompatibilityErr      error
}
```

fsm：维护了Mongodb集群的信息，如果server description有变更，可以根据不同的TopologyKind进行更新topology对应的servers列表

### Server

Server中核心函数是update()，负责持续进行heartbeat，并更新 最新的description.Server的订阅者。

### server selection算法

ServerSelector接口定义：

```
// ServerSelector is an interface implemented by types that can perform server selection given a topology description
// and list of candidate servers. The selector should filter the provided candidates list and return a subset that
// matches some criteria.
type ServerSelector interface {
	SelectServer(Topology, []Server) ([]Server, error)
}

// ServerSelectorFunc is a function that can be used as a ServerSelector.
type ServerSelectorFunc func(Topology, []Server) ([]Server, error)

// SelectServer implements the ServerSelector interface.
func (ssf ServerSelectorFunc) SelectServer(t Topology, s []Server) ([]Server, error) {
	return ssf(t, s)
}
```

Mongodb提供了多种server selection选择算法：

+ LatencySelector
+ CompositeSelector
+ WriteSelector
+ ReadPrefSelector：基于给定的read preference选择Server.
+ OutputAggregateSelector：基于给定的read preference选择Server，同时假设底层操作与输出阶段aggregate。

Mongodb支持的readpref Mode有：

```
// Mode indicates the user's preference on reads.
type Mode uint8

// Mode constants
const (
	_ Mode = iota
	// PrimaryMode indicates that only a primary is
	// considered for reading. This is the default
	// mode.
	PrimaryMode
	// PrimaryPreferredMode indicates that if a primary
	// is available, use it; otherwise, eligible
	// secondaries will be considered.
	PrimaryPreferredMode
	// SecondaryMode indicates that only secondaries
	// should be considered.
	SecondaryMode
	// SecondaryPreferredMode indicates that only secondaries
	// should be considered when one is available. If none
	// are available, then a primary will be considered.
	SecondaryPreferredMode
	// NearestMode indicates that all primaries and secondaries
	// will be considered.
	NearestMode
)
```

### Pool

### Connection

Pool、Connection模块相对独立

## 参考

1. [mongodb driver specification](https://github.com/mongodb/specifications/tree/master/source)
2. [mongo-go-driver](https://github.com/mongodb/mongo-go-driver)
