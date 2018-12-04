---
layout: post
title: MongoDB笔记 -- 查询操作
date: 2017-03-13
excerpt: "mongoDB下进行查询操作"
tag:
- mongoDB
---

## `find`简介

MongoDB中使用`find`来进行查询，`find`的第一个参数决定了要返回哪些文档，其形式也是文档，说明要执行能够的查询细节。

空的查询文档会匹配集合的全部内容。

当我们开始想查询文档中添加键/值对，就意味着限定了查找的条件。也可以通过想查询文档中加入多个键/值对的方式将多个查询条件组合到一起。

```
> db.users.insert({"username":"joe", "age":27})
WriteResult({ "nInserted" : 1 })
> db.users.find()
{ "_id" : ObjectId("58b170271d0fd17fd0b5328b"), "username" : "joe", "age" : 27 }
> db.users.find({"age":27})
{ "_id" : ObjectId("58b170271d0fd17fd0b5328b"), "username" : "joe", "age" : 27 }
> db.users.find({"username":"joe"})
{ "_id" : ObjectId("58b170271d0fd17fd0b5328b"), "username" : "joe", "age" : 27 }
> db.users.find({"username":"joe", "age":27})
{ "_id" : ObjectId("58b170271d0fd17fd0b5328b"), "username" : "joe", "age" : 27 }
```

### 指定返回的键

如果不需要将文档中全部的键/值对返回，可以通过`find`的第二个参数来指定想要的键。

```
> db.users.find({}, {"username":1, "email":1})
{ "_id" : ObjectId("58b170271d0fd17fd0b5328b"), "username" : "joe", "email" : "joe.example.com" }
```

也可以用第二个参数来剔除查询结果中的某个键/值对。

```
> db.users.update({"username":"joe"}, {$set: {"email":"joe.example.com", "sex":"male"}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.users.findOne()
{
	"_id" : ObjectId("58b170271d0fd17fd0b5328b"),
	"username" : "joe",
	"age" : 27,
	"email" : "joe.example.com",
	"sex" : "male"
}
> db.users.find({}, {"username":1,"_id":0})
{ "username" : "joe" }
{ "username" : "yang" }
```

## 查询条件

"$lt","$lte","gt","gte"就是全部的比较操作符，分别对应<、>、>=、<=。可以将其组合起来以便查找一个范围的值。

```
> db.users.find({"age":{"$gte": 18, "$lte":33}})
{ "_id" : ObjectId("58b170271d0fd17fd0b5328b"), "username" : "joe", "age" : 27, "email" : "joe.example.com", "sex" : "male" }
{ "_id" : ObjectId("58b1732b1d0fd17fd0b5328c"), "username" : "yang", "age" : 24, "sex" : "male" }
> db.users.find({"age":{"$gte": 25, "$lte":33}})
{ "_id" : ObjectId("58b170271d0fd17fd0b5328b"), "username" : "joe", "age" : 27, "email" : "joe.example.com", "sex" : "male" }
```

对于文档的键值不等于某个特定值的情况，就要适用另外一种条件操作符"$ne"。

"$in"用来查询一个键的多个值。"$or"用来完成多个键值的任意给定值。

对于单一键要是有多个值与其匹配的话，就是要用"$in"加一个条件数组。

"$nin"将返回与数组所有条件都不匹配的文档。

"$or"可以含有其他条件句。

"$not"是元条件句，即可以用在任何其他条件之上。

> 条件句是内层文档的键，而修改器是外层文档的键。一个键可以有多个条件，但是一个键不能对应多个更新修改器。

## 特定于类型的查询

null不仅仅匹配自身，而且匹配“不存在的”。

正则表达式能够灵活有效地匹配字符串。

```
> db.users.find({"username":/joe/i})
{ "_id" : ObjectId("58b170271d0fd17fd0b5328b"), "username" : "joe", "age" : 27, "email" : "joe.example.com", "sex" : "male", "register" : ISODate("2017-02-25T12:22:45.603Z"), "userId" : 12 }
{ "_id" : ObjectId("58b1784d1d0fd17fd0b5328d"), "username" : "joe" }
{ "_id" : ObjectId("58b17cdf1d0fd17fd0b53291"), "username" : "JOe" }
```

### 查询数组

```
> db.users.insert({"language":["english", "chinese", "french"]})
WriteResult({ "nInserted" : 1 })
> db.users.find({"language":"english"})
{ "_id" : ObjectId("58b17e541d0fd17fd0b53292"), "language" : [ "english", "chinese", "french" ] }
```

#### `$all`可以通过多个元素来匹配数组。

```
> db.user.find({"fruit":{$all: ["apple", "banana"]}})
> db.users.find({"fruit":{$all: ["apple", "banana"]}})
{ "_id" : 1, "fruit" : [ "apple", "banana", "peach" ] }
{ "_id" : 2, "fruit" : [ "apple", "banana", "orange" ] }
{ "_id" : 3, "fruit" : [ "apple", "cherry", "banana" ] }
```

#### `$size`可以用其查询指定长度的数组。

```
> db.users.find({"language":{$size: 3}})
{ "_id" : ObjectId("58b17e541d0fd17fd0b53292"), "language" : [ "english", "chinese", "french" ] }
```

#### `$slice`可以返回数组的子集合。


### 查询内嵌文档

有两种方法查询内嵌文档：查询整个文档，或者只针对其键/值对进行查询。

查询整个内嵌文档和普通查询完全相同。

```
> db.users.update({"username":"yang"}, {$set: {"name": {"first":"joe", "last":"Schmoe"}}})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.users.findOne({"username":"yang"})
{
	"_id" : ObjectId("58b1732b1d0fd17fd0b5328c"),
	"username" : "yang",
	"age" : 24,
	"sex" : "male",
	"register" : ISODate("2017-01-01T16:00:00Z"),
	"name" : {
		"first" : "joe",
		"last" : "Schmoe"
	}
}
> db.users.find({"name":{"first":"joe", "last":"Schmoe"}})
{ "_id" : ObjectId("58b1732b1d0fd17fd0b5328c"), "username" : "yang", "age" : 24, "sex" : "male", "register" : ISODate("2017-01-01T16:00:00Z"), "name" : { "first" : "joe", "last" : "Schmoe" } }
```

如果允许的话，通常只针对内嵌文档的特定键值进行查询才是比较好的做法，我们可以适用点表示法查询内嵌的键

```
> db.users.find({"name.first":"joe", "name.last":"Schmoe"})
{ "_id" : ObjectId("58b1732b1d0fd17fd0b5328c"), "username" : "yang", "age" : 24, "sex" : "male", "register" : ISODate("2017-01-01T16:00:00Z"), "name" : { "first" : "joe", "last" : "Schmoe" } }
```

查询文档可以包含点，来表示“深入内嵌文档内部”的意思。点表示法也是待插入的文档不能包含“.”的原因。将键作为URL保存的时候经常会遇到此类问题。一种解决方法就是在插入前或这提取后执行一个全局替换，将点替换成一个URL中的非法字符。

要正确地指定一组条件，而不用指定每个键，要使用“$elemMatch”。这种模糊的命名条件句能用来部分指定匹配数组中的单个内嵌文档的限定条件。

```
> db.blog.posts.find({"comments":{"$elemMatch": {"name":"Bob","votes":{"$lte":5}}}})
{ "_id" : ObjectId("58aad91df735df8e475cfbaa"), "title" : "A blog post", "content" : "blog content", "comments" : [ { "name" : "joe", "email" : "jim", "content" : "nice to meet you", "author" : "jim" }, { "name" : "Bob", "email" : "bob@example.com", "content" : "nice to meet you", "votes" : 3 } ], "email" : [ "joe@gmail.com", "joe@mail.com", "joe@php.net", "joe@python.org" ] }
```

## `$where`查询

键`/`值对是很有表现力的查询方式。不是非常必要时，一定要避免适用`$where`查询，因为它们在速度上要比常规查询慢很多。

## 游标

数据库适用游标来返回`find`的执行结果。客户度对游标的实现通常能够对最宗结果进行有效的控制。可以限制结果的数量，略过部分结果，根据任意方向任意键的组合对经过进行各种排序，或者是执行其他一些功能强大的操作。

游标类实现了迭代器接口，所以可以在`foreach`循环中使用。

### `limit`和`skip`和`sort`

`limit`：限制返回结果的数量。

`skip`：忽略一定数量结果。

`sort`：用一个对象作为参数，一组键/值对，键对应文档的键名，值代表排序的方向，排序方向可以是1(升序)或者-1(降序)。如果指定了多个键，按照多个键的顺序逐个排序。

### 避免使用skip略过大量结果

不用`skip`对结果分页

避免随机获取文档。｀
