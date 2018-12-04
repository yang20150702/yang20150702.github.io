---
layout: post
title: MongoDB笔记 -- 更新文档
date: 2017-03-09
excerpt: "mongoDB中更新文档的多种方式"
tag:
- mongoDB
---

文档存入数据库后，就可以使用`update`方法来修改它。`update`有两个参数，一个是查询文档，用来找出要更新的文档，另一个是修改器文档，描述对找到的文档做哪些更改。


更新操作是原子的：若两个更新同时发生，先到达服务器的先执行，接着执行另外一个。所以，互相有冲突的更新可以火速传递，并不会相互干扰，最后的更新会取得“胜利”。

## 文档替换

更新最简单的情形就是完全用一个新的文档替换匹配的文档。这适用于模式结构发生了较大变化的时候

```
> user = {"name": "joe",
... "friends": 32,
... "enemies": 2
... }
{ "name" : "joe", "friends" : 32, "enemies" : 2 }
> db.users.insert(user)
WriteResult({ "nInserted" : 1 })
> db.users.findOne()
{
	"_id" : ObjectId("586dae25f1dfd9cdef84aa77"),
	"name" : "joe",
	"friends" : 32,
	"enemies" : 2
}
> var joe = db.users.findOne({"name": "joe"});
> joe
{
	"_id" : ObjectId("586dae25f1dfd9cdef84aa77"),
	"name" : "joe",
	"friends" : 32,
	"enemies" : 2
}
> joe.relationships = {"friends": joe.friends, "enemies":joe.enemies}
{ "friends" : 32, "enemies" : 2 }
> joe.username = joe.name
joe
> delete joe.friends
true
> delete joe.enemies
true
> delete joe.name
true
> db.users.findOne()
{
	"_id" : ObjectId("586dae25f1dfd9cdef84aa77"),
	"name" : "joe",
	"friends" : 32,
	"enemies" : 2
}
> joe
{
	"_id" : ObjectId("586dae25f1dfd9cdef84aa77"),
	"relationships" : {
		"friends" : 32,
		"enemies" : 2
	},
	"username" : "joe"
}
> db.users.update({"name": "joe"}, joe)
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.users.findOne()
{
	"_id" : ObjectId("586dae25f1dfd9cdef84aa77"),
	"relationships" : {
		"friends" : 32,
		"enemies" : 2
	},
	"username" : "joe"
}
```

## 使用修改器

通常文档只会有一部分要更新。利用原子的更新修改器。可以使得部分更新极为高效。更新修改器是种特殊的键，用来指定复杂的更新操作，比如调整、增加或删除键，还可能是操作数组或者内嵌文档。


使用修改器时,`_id`的值不能改变。（注意，整个文档替换时是可以改变`_id`的）其他键值，都是可以更改的。

1. `$set`修改器入门

`$set`用来指定一个键的值。如果这个键不存在，则创建它。这对更新模式或者增加用户定义键来说非常方便。

```
> use users
switched to db users
> db.users.insert({"name": "joe", "age": 30, "sex": "male", "lacation": "Wisconsin" })
WriteResult({ "nInserted" : 1 })
> db.users.findOne()
{
	"_id" : ObjectId("586fd72b1d31cf5a05fe9064"),
	"name" : "joe",
	"age" : 30,
	"sex" : "male",
	"lacation" : "Wisconsin"
}
> db.users.update({"_id" : ObjectId("586fd72b1d31cf5a05fe9064")}, {"$set": {"favorite book": "war and peace"}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.users.findOne()
{
	"_id" : ObjectId("586fd72b1d31cf5a05fe9064"),
	"name" : "joe",
	"age" : 30,
	"sex" : "male",
	"lacation" : "Wisconsin",
	"favorite book" : "war and peace"
}
> db.users.update({'name':'joe'},
... {'$set': {'favorite book': 'green eggs and ham'}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.users.findOne()
{
	"_id" : ObjectId("586fd72b1d31cf5a05fe9064"),
	"name" : "joe",
	"age" : 30,
	"sex" : "male",
	"lacation" : "Wisconsin",
	"favorite book" : "green eggs and ham"
}

```

用`$set`甚至可以修改键的数据类型。

```
> db.users.update({'name':'joe'}, {'$set': {'favorite book': ["cat's cradle", "foundation trilogy", "ender's game"]}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.users.findOne()
{
	"_id" : ObjectId("586fd72b1d31cf5a05fe9064"),
	"name" : "joe",
	"age" : 30,
	"sex" : "male",
	"lacation" : "Wisconsin",
	"favorite book" : [
		"cat's cradle",
		"foundation trilogy",
		"ender's game"
	]
}
```

用`$unset`将键完全删除。

```
> db.users.update({"name": "joe"},
... {"$unset": {"favorite book": 1}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.users.findOne()
{
	"_id" : ObjectId("586fd72b1d31cf5a05fe9064"),
	"name" : "joe",
	"age" : 30,
	"sex" : "male",
	"lacation" : "Wisconsin"
}
```

用`$set`也可以修改内嵌文档：

```
> use blog
switched to db blog
> db.blog.findOne()
null
> db.blog.posts.insert({"title": "A Blog Post",
... "content": "...",
... "author": {
...     "name": "joe",
...     "email": "joe@example.com"
... }})
WriteResult({ "nInserted" : 1 })
> db.blog.posts.findOne()
{
	"_id" : ObjectId("586fd9771d31cf5a05fe9065"),
	"title" : "A Blog Post",
	"content" : "...",
	"author" : {
		"name" : "joe",
		"email" : "joe@example.com"
	}
}
> db.blog.posts.update({"author.name": "joe"},
... {"$set": {"author.name": "joe schmoe"}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.blog.posts.findOne()
{
	"_id" : ObjectId("586fd9771d31cf5a05fe9065"),
	"title" : "A Blog Post",
	"content" : "...",
	"author" : {
		"name" : "joe schmoe",
		"email" : "joe@example.com"
	}
}
```

> 增加、删除或修改键的时候，应该使用`$`修改器。

### 增加和减少

`$inc`修改器用来增加已有键的值，或者在键不存在时创建一个键。对于分析数据、因果关系、投票或者其他有变化数值的地方，使用这个都会很方便。

假如建立了一个游戏集合，将游戏和变化的分数都存储在里面。比如用户玩弹球游戏(pinall),可以插入一个包含游戏名和玩家的文档来标识不同的游戏。

```
> db.games.insert({"game": "pinall",
... "user": "joe"})
WriteResult({ "nInserted" : 1 })
> db.games.findOne()
{
	"_id" : ObjectId("586feb741d31cf5a05fe9066"),
	"game" : "pinall",
	"user" : "joe"
}
```

要是小球撞到砖块，就会给玩家加分。分数可以随便给，这里把玩家得分技术约定为50。使用`$inc`修改器给玩家加50分：

```
> db.games.update({"game": "pinall", "user": "joe"},
... {"$inc": {"score": 50}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.games.findOne()
{
	"_id" : ObjectId("586feb741d31cf5a05fe9066"),
	"game" : "pinall",
	"user" : "joe",
	"score" : 50
}
```

分数键原来并不存在，所以`$inc`创建了这个键，并把值设定为增加量：50.

如果小球落入加分区，要加10000分，只要给`$inc`传递一个不同的值就行。

```
> db.games.update({"game": "pinall", "user": "joe"}, {"$inc": {"score": 10000}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.games.findOne()
{
	"_id" : ObjectId("586feb741d31cf5a05fe9066"),
	"game" : "pinall",
	"user" : "joe",
	"score" : 10050
}
```

`score`键存在并有数字类型的值，所以服务器就把这个值加了10000。


`$inc`和`$set`的用法类似，就是专门来增加（和减少）数字的。`$inc`只能用于整数、长整数或双精度浮点数。要是用在其他类型的数据上就会导致操作失败。其中包括很多语言自动转换成数字的类型，例如null、布尔类型或数字构成的字符串。

另外，`$inc`键的值必须为数字。不能使用字符串、数组或其他非数字的值。
要修改其他类型应该使用`$set`或者接下来提到的数组修改器。

### 数组修改器

数组是常用且非常有用的数据结构：它们不仅是可通过索引进行引用的列表，而且还可以作为集合来用。

数组操作，只能用值为数组的操作上。

如果指定的键已经存在，`$push`会向已有的数组末尾加入一个元素，要是没有就会创建一个新的数组。
例如，假设要存储博客文章，要添加一个包含一个数组的"comments"的键。可以向还不存在的"comments"数组`push`一个评论，这个数组会被自动创建，并加入评论。

```
> use blog
switched to db blog
> db.blog.posts.insert({"title":"A blog post",
... "content":"blog content"})
WriteResult({ "nInserted" : 1 })
> db.blog.posts.findOne()
{
	"_id" : ObjectId("58aad91df735df8e475cfbaa"),
	"title" : "A blog post",
	"content" : "blog content"
}
> db.blog.posts.update({"title":"A blog post"}, {$push: {"comments": {"name":"joe", "email":"joe@example.com", "content":"nice to meet you"}}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.blog.posts.findOne()
{
	"_id" : ObjectId("58aad91df735df8e475cfbaa"),
	"title" : "A blog post",
	"content" : "blog content",
	"comments" : [
		{
			"name" : "joe",
			"email" : "joe@example.com",
			"content" : "nice to meet you"
		}
	]
}

```

如果一个值不在数组里面就把它加进去。可以在查询文档中用`$ne`来实现。

也可以用`$addToSet`完成同样的事，有些情况`$ne`根本行不通，有些时候更适合用`$addToSet`。

例如，有一个表示用户的文档，已经有了电子邮件地址信息，当添加新的地址时，用`$addToSet`可以避免重复。

```
>db.blog.posts.update({"_id":ObjectId("58aad91df735df8e475cfbaa")}, {"$addToSet": {"email":"joe@gmail.com"}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 0 })
> db.blog.posts.findOne()
{
	"_id" : ObjectId("58aad91df735df8e475cfbaa"),
	"title" : "A blog post",
	"content" : "blog content",
	"comments" : [
		{
			"name" : "joe",
			"email" : "joe@example.com",
			"content" : "nice to meet you"
		},
		{
			"name" : "Bob",
			"email" : "bob@example.com",
			"content" : "nice to meet you"
		}
	],
	"email" : [
		"joe@gmail.com"
	]
}
> db.blog.posts.update({"_id":ObjectId("58aad91df735df8e475cfbaa")}, {"$addToSet": {"email":"joe@mail.com"}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.blog.posts.findOne()
{
	"_id" : ObjectId("58aad91df735df8e475cfbaa"),
	"title" : "A blog post",
	"content" : "blog content",
	"comments" : [
		{
			"name" : "joe",
			"email" : "joe@example.com",
			"content" : "nice to meet you"
		},
		{
			"name" : "Bob",
			"email" : "bob@example.com",
			"content" : "nice to meet you"
		}
	],
	"email" : [
		"joe@gmail.com",
		"joe@mail.com"
	]
}

```

将`$addToSet`和`$each`组合起来，可以添加多个不同的值，而用`$ne`和`$push`组合就不能实现。
例如，像一次添加多个邮件地址，就可以使用这些修改器。

```
> db.blog.posts.update({"_id":ObjectId("58aad91df735df8e475cfbaa")}, {"$addToSet": {"email":{"$each":["joe@mail.com", "joe@php.net","joe@python.org"]}}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.blog.posts.findOne()
{
	"_id" : ObjectId("58aad91df735df8e475cfbaa"),
	"title" : "A blog post",
	"content" : "blog content",
	"comments" : [
		{
			"name" : "joe",
			"email" : "joe@example.com",
			"content" : "nice to meet you"
		},
		{
			"name" : "Bob",
			"email" : "bob@example.com",
			"content" : "nice to meet you"
		}
	],
	"email" : [
		"joe@gmail.com",
		"joe@mail.com",
		"joe@php.net",
		"joe@python.org"
	]
}

```

有几个从数组总删除元素的方法。若是把数组看成队列或者栈，可以用`$pop`这个修改器可以从数组任何一端删除元素。`{$pop: {key : 1}}`从数组末尾删除一个元素，`{$pop : {key : 1}}`则从头部删除。


有时需要基于特定条件来删除元素，而不仅仅是依据位置，`$pull`可以做到。
例如，有个待办事项列表，顺序有问题，要像把洗衣服(laundry)放到第一位，可以从列表中先删掉。

```
> db.lists.insert({"todo":["dishes", "laundry", "dry cleaning"]})
WriteResult({ "nInserted" : 1 })
> db.lists.find()
{ "_id" : ObjectId("58aadd6cf735df8e475cfbab"), "todo" : [ "dishes", "laundry", "dry cleaning" ] }
> db.lists.update({}, {"$pull":{"todo": "laundry"}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.lists.find()
{ "_id" : ObjectId("58aadd6cf735df8e475cfbab"), "todo" : [ "dishes", "dry cleaning" ] }
```

### 数组的定位修改器

若是数组中有多个值，而我们只想对其中的一部分进行操作，这就需要一些技巧。有两种方法操作数组中的值：通过位置或者定位操作符("$")


数组都是以0开头的，可以将下标直接作为键来选择元素。


但是很多情况下，不预先查询文档就不能知道要修改数组的下标。为了克服这个困难，MongoDB提供来定位操作符"$",用来定位查询文档已经匹配的元素，并进行更新。

例如，要是用户john把email改成Jim，就可以用定位符替换评论中的名字：

```
> db.blog.posts.update({"comments.email":"joe@example.com"}, {"$set": {"comments.$.email": "jim"}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.blog.posts.findOne()
{
	"_id" : ObjectId("58aad91df735df8e475cfbaa"),
	"title" : "A blog post",
	"content" : "blog content",
	"comments" : [
		{
			"name" : "joe",
			"email" : "jim",
			"content" : "nice to meet you",
			"author" : "jim"
		},
		{
			"name" : "Bob",
			"email" : "bob@example.com",
			"content" : "nice to meet you"
		}
	],
	"email" : [
		"joe@gmail.com",
		"joe@mail.com",
		"joe@php.net",
		"joe@python.org"
	]
}
```

定位符只更新第一个匹配的元素。所以，如果John有不止一个评论，那么只有他的第一条评论中的名字会被更改。

## 修改器速度


## upsert

`upsert`是一种特殊的更新。要是没有找到符合更新条件，就会以这个条件和更新文档为基础创建一个新的文档。如果找到匹配的文档，则正常更新。upsert不必预置集合，同一套代码可以用于创建又可以用于更新文档。

## 更新多个文档

默认情况下，更新只能对符合匹配条件的第一个文档执行操作。要是有多个文档符合条件，其余的文档就没有变化。要使所以匹配到的文档都得到更新，可以设置`update`的第4个参数为true。

## 返回已更新的文档

用`getLastError`仅能获得有限的信息，并不能返回已更新的文档。
