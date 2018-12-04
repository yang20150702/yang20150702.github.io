---
layout: post
title: 在Flask中使用MongoEngine
date: 2017-04-02
excerpt: "介绍了如何在Flask下使用mongoEngine，以及MongoEngine中文档、字段类型、文档类型、meta属性以及CRUD四种操作"
tag:
- Flask
- mongoDB
comments: true
---

## 安装MongoDB

见[`MongoDB`] [MongoDB] 官网

[MongoDB]: https://mongodb.com/ "MongoDB"

## 配置MongoEngine

用`pip`安装`Flask-MongoEngine`:

```
pip install Flask-MongoEngine
```

在`config.py`中，加入`mongo`连接所需要的参数：

```
MONGODB_SETTINGS = {
    'db': 'local',  #可以更改
    'host': 'localhost',
    'port': 27017
}
```


在`models.py`中创建一个`mongo`对象，以表示我们的数据库：

```
from flask_mongoengine import MongoEngine

db = MongoEngine()
```

在`__init__.py`中，对app进行初始化。

```
from models.py import mongo

mongo.init_app(app)
```

## 文档

`MongoEngine`是基于`Python`的对象系统设计的`MongoDB`专用的`ORM`框架。

`MongoDB`是无模式的，这意味着数据库不会执行模式，我们可以在我们想要的时候添加和删除字段。这使得在很多方面开发容易得多，特别是当数据模型发生变化时。然而，为我们的文档定义模式可以帮助解决涉及不正确类型或缺少字段的错误，并且允许我们以传统`ORM`相同的方式在文档上定义实用程序方法。

```
class Comment(mongo.EmbeddedDocument):

    name = mongo.StringField(required=True)
    text = mongo.StringField(required=True)
    date = mongo.DateTimeField(
        default=datetime.datetime.now()
    )

    def __repr__(self):
        return "<Comment {}>".format(self.text[:15])
```

## 字段类型

在`MongoEngine`中有大量的字段类型。每种都代表了`Mongo`中不同的数据种类。跟底层的数据库不同，每个字段都会提供类型检查，检查通过后，才允许对文档进行保存或修改。最常用的字段类型如下：

+ `BooleanField`
+ `DateTimeField`
+ `DictField`
+ `DynamicField`
+ `EmbeddedDocumentField`
+ `FloatField`
+ `IntField`
+ `ListField`
+ `ObjectField`
+ `ReferenceField`
+ `StringField`

> `DynamicField`可以接收任意类型值的字段，不会对值做任意类型的检查。

　`DictField`可以存储能够被`json.dumps()`序列化的任意`Python`字典。

　`ReferenceField`只简单地保存一个文档的唯一ID，当被查询的时候，`MongoEngine`会根据ID返回被引用的文档。跟`ReferenceField`不同，`EmbeddedDocumentField`会接收一个被传入的文档，将其保存在父文档中，这样就不必进行二次查询。`ListField`则表示由指定类型组成的列表。


在用字段类型生成字段实例时，可以传入一些通用的参数：

```
Field(
    primary_key=Fase,
    db_field=None,
    required=False,
    default=None,
    unique=False,
    unique_with=None,
    choices=None
    )
```

如果传入`primary_key`参数，则表示你不希望`mongoengine`去自动生成唯一的标识键，而采用传入该字段的值作为其id，可以通过`id`属性或者该字段名来读取这个值。实际上，id是主键的别名。

`db_field`定义了它在文档中使用的键名。如果没有设置，则缺省值就是那个类属性的名字。

如果把`required`设置为True，则要求这个键必须出现在文档中。如果不设置，则在该类文档就不一定会存在这个键。如果查询一个在类中有定义但不存在的键，则结果返回`None`。

`default`指定了当没有为该字段赋值时返回的默认值。

如果`unique`设置为True，则`MongoEngine`会检查并确保集合中没有其他文档在这个字段有同样的值。

`unique_with`可以接收单个字段或多个字段的列表，它会确保这些字段的值的组合在每个文档中是唯一的。这很像关系型数据库中的多列联合唯一索引。

如果给`choices`传入一个列表　，则这个字段的值将会限制为只允许从这个列表中选择。

## 文档类型

在`MongoDB`中，文档相当于`RDBMS`中的一行。在使用关系型数据库时，行存储在表中，这些行具有行遵循的严格模式。`MongoDB`将文档存储在集合而不是表中，二者之间的主要区别在于数据库级别不执行模式。

### Document

`MongoEngine`允许你为文档定义模式，这有助于减少编码错误，允许在可能存在的字段上定义实用方法。

为文档定义一个模式，创建一个继承自`Document`的类。

```
class Page(mongo.Document):
    title = StringField(required=True)
    date_modified = DateTimeField(default=datetime.datetime.now)
```

如果从`mongo.Document`继承，则意味着只有在类中定义了的键会被保存到数据库中，那些定义过的键可以为空，而其他的键值都会被忽略掉。

### DynamicDocument

`MongoDB`的优点之一是集合的动态模式，而数据应该被计划和组织（**显式优于隐式**），有些场景需要动态\扩展样式文档。

如果你的类是从`mongo.DynamicDocument`继承的，那么任何额外的字段都会被认为是`DynamicField`，并且会被保存到文档中。

### EmbeddedDocument

EmbeddedDocument类型就是一个内嵌的文档，可以把它传给`EmbeddedDocumentField`类型的字段，保存在该字段的文档中。

## meta属性

文档的很多属性，都可以通过类属性`meta`来手动设置。

### Document collections文档集合

从`Document`直接继承的文档类将在数据库中拥有自己的集合。集合的名称是默认的类的名称，转换为小写。如果需要更改集合的名称（例如，在现有数据库上使用`MongoEngine`），则在文档中创建一个名为`meta`的类字典属性，并将集合设置为您希望文档类使用的集合的名称。

### Capped collections

文档可以通过在`meta`字典中指定`max_documents`和`max_size`来使用`Capped`集合。`max_documents`是允许存储在集合中的最大文档数，`max_size`是集合每个文档的最大大小（以字节为单位）。如果未指定`max_size`，并且`max_documents`指定了，`max_size`默认为`10485760`字节（10MB）。

以下示例显示一个日志文档，限制为1000个条目和2MB的磁盘空间：

```
class Log(Document):
    ip_address = StringField()
    meta = {'max_documents': 1000, 'max_size': 200000}
```


### 索引

您可以在集合上指定索引以使查询更快。这是通过在元字典中创建一个称为索引的索引规范的列表来完成的，其中索引规范可以是单个字段名称，包含多个字段名称的元组或包含完整索引定义的字典。

可以通过在字段名称前加一个`+`（升序）或`-`（降序）来指定方向。请注意，方向只对`multi-field`指标有影响。文本索引可以通过用一个$前缀字段名来指定。哈希索引可以通过在字段名称前面加上\#。


```
class Page(Document):
    category = IntField()
    title = StringField()
    rating = StringField()
    created = DateTimeField()
    meta = {
        'indexes': [
            'title',
            '$title', # text index
            '#title', # hashed index
            ('title', '-rating'),
            ('category', '_cls'),
            {
                'fields': ['created'],
                'expireAfterSeconds': 3600
            }
        ]
        'ordering': ['-created'] #设定集合中默认的排序方式
    }
```

### 继承

通过`meta`变量还可以设置为允许继承，以实现用户自定义的文档，允许继承默认是关闭的。**子类文档会被认为是父类文档类型的成员，被保存在相同的集合中。**

```
class Post(mongo.Document):
    ....
    meta = {'allow_inheritance': True}
```

## CRUD

任何数据库存储都需要实现4种主要的数据操作方式：创建新数据、读取已有的数据、更新已有的数据、以及删除数据。

### 创建(C)

要创建一个新文档，则需要创建该类的一个新实例，并调用其`save`方法。

`MongoEngine`不会在`ReferenceField`中自动保存关联对象。

如果要在保存当前文档变更的同时对引用文档的变更也进行保存，则需要把`cascade`参数设为True。

在插入一个文档的时候，会根据类中的参数定义进行类型检查，如果你希望跳过这一检查，则可以把`validate`设为False。

```
post.save(validate=False)
```

### 写入级别

如果要让`MongoDB`确保数据已写到磁盘上之后才认为发生了写入，则可以使用`write_concern`关键字。写入级别(write concern)决定了`Mongo`何时返回写入完成的状态。

### 读取数据

通过`objects`属性可以访问数据库中的文档。使用`all`方法可以取出集合中的所有文档。

### 修改数据

要修改数据，则可以对查询出的结果调用`update`方法。

### 删除数据

要删除一个文档，则可以调用它的`delete`方法。


## `NoSQL`中的关联关系

### 一对多关系

在`MongoEngine`中，有两种方法可以创建一对多关系。

第1种方法是使用`ReferenceField`指向另一个对象的ID，以及在两个文档之间建立联系。

通过`ReferenceField`属性可以直接访问被引用的对象。


第2中方法是在`EmbeddedDocumentField`中保存`EmbeddedDocument`，以创建一对多关系。

### 多对多关系

在文档数据库中不存在多对多的概念。因为存在于不同的`ListField`中的对象，互相之间没有任何联系。
