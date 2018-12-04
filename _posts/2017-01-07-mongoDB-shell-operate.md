---
layout: post
title: MongoDB笔记 -- shell基本操作
date: 2017-01-07
excerpt: ""
tag:
- mongoDB
comments: true
---

MongoDB自带一个JavaScript shell，可以从命令行与MongoDB实例交互，通过shell可以执行管理操作、检查运行实例。


`user 数据库名`: 选择要使用的数据库


通过db变量来访问其中的集合。

## shell中的基本操作

在`shell`查看操作会用到`4`个基本操作：创建、读取、更新和删除(`CRUD`).

### 创建

`insert`函数添加一个文档到集合里面。例如，假设要存储一篇博客文章。

首先创建一个局部变量post,内容是代表文档的JavaScript对象，里面会有'title', 'content'和'date'几个键。

```
> use blog       #创建一个数据库
switched to db blog
> db
blog
> post = {"title": "My Blog Post",
... "content": "here's a blog post",
... "date": new Date()}
{
	"title" : "My Blog Post",
	"content" : "here's a blog post",
	"date" : ISODate("2017-01-04T14:02:23.074Z")
}
> db.blog.insert(post)
WriteResult({ "nInserted" : 1 })
> db.blog.find()
{ "_id" : ObjectId("586d009684c23995b55f469a"), "title" : "My Blog Post", "content" : "here's a blog post", "date" : ISODate("2017-01-04T14:02:23.074Z") }
> db.blog.findOne()
{
	"_id" : ObjectId("586d009684c23995b55f469a"),
	"title" : "My Blog Post",
	"content" : "here's a blog post",
	"date" : ISODate("2017-01-04T14:02:23.074Z")
}

```

### 读取

find会返回集合里面所有的文档。若查看一个文档，可以用findOne,
使用find时，shell自动显示最多29个匹配的文档，但可以获取更多文档。

### 更新

`update`用来更改文档内容。`update`接受（至少）两个参数：第一个参数是要更新文档的限定条件，第二个是新的文档。

假设决定给我们先前写的文章增加评论内容，则需要增加一个新的键，对应的值是存放评论的数组。

```
修改变量post,增加"comments"键:
> post.comments = []
[ ]
> db.blog.update({title: "My Blog Post"}, post)
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
> db.blog.findOne()
{
	"_id" : ObjectId("586d009684c23995b55f469a"),
	"title" : "My Blog Post",
	"content" : "here's a blog post",
	"date" : ISODate("2017-01-04T14:02:23.074Z"),
	"comments" : [ ]
}

```

### 删除

`remove`用来从数据库中永久地删除文档。当不使用参数进行调用的情况下，它会删除一个集合内的所有文档。它也可以接收一个文档以指定限定条件。

```
> db.blog.remove({title: "My Blog Post"})
WriteResult({ "nRemoved" : 1 })
> db.blog.find()
>
```

### 使用shell的窍门

使用`db.help()`可以查看数据库级别的命令的帮助，集合的相关帮助可以通过`db.blog.help()`来查看


了解函数功能的技巧：在输入的时候不用输括号，就会显示该函数的JavaScript源代码。

使用`db.集合名`的方式来访问集合一般不会有问题，但如果集合名恰好是数据库类的一个属性就有问题。

例如，要访问`version`这个集合，使用`db.version`就不行，因为`db.version`是一个数据库函数。

```
> db.version
function () {
        return this.serverBuildInfo().version;
    }
> db.getCollection("version")
blog.version
```

当JavaScript只有在db中找不到指定的属性时，才会将其作为集合返回。当有属性与目标集合同名时，可以使用`getCollection`函数。
