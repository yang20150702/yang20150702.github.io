---
layout: post
title: "Python 装饰器"
date: 2018-05-08 20:30:45
excerpt: "python decorator用法"
tag:
- Python
- 装饰器
comments: true
---

## 定义

装饰器可以通过某种方式来增强函数的行为。装饰器是一个可调用对象，其参数为一个被装饰的函数，返回被装饰的函数，或者替换为另一个函数或者可调用对象。

装饰器的应用场景是针对被装饰的函数提供在其周围进行调用的通用代码。例如增加日志、计时等。

## 参数化装饰器

```python
In [1]: import time

In [2]: from functools import wraps

In [3]: def time_show(func):
   ...:     @wraps(func)
   ...:     def wrapper(*args, **kwargs):
   ...:         start = time.time()
   ...:         result = func(*args, **kwargs)
   ...:         end = time.time()
   ...:         print("func.__name__: {}, spend time: {}".format(
   ...:             func.__name__, end - start))
   ...:         return result
   ...:     return wrapper
   ...:
   ...:

In [4]: @time_show
   ...: def countdown(n):
   ...:     while n > 0:
   ...:         n -= 1
   ...:

In [5]: countdown(100000)
func.__name__: countdown, spend time: 0.01636981964111328

In [6]: countdown(1000000)
func.__name__: countdown, spend time: 0.13895082473754883

```

## 带参数的装饰器

实现方法：最外层的函数接受参数，并将它们作用在内部的装饰函数上面，内部的decorate函数接受一个函数作为参数，wrapper函数内部进行装饰操作。

```python
In [51]: def add_name(name):
    ...:     def decorate(func):
    ...:         @wraps(func)
    ...:         def wrapper(*args, **kwargs):
    ...:             print("{} doing".format(name))
    ...:             return func(*args, **kwargs)
    ...:         return wrapper
    ...:     return decorate
    ...:

In [52]: @add_name('yang')
    ...: def add(x, y):
    ...:     return x + y
    ...:

In [53]: add(2,3)
yang doing
Out[53]: 5
```



## 类装饰器

定义一个类装饰器，需要确保它实现了`__call__()`和`__get__()`方法。

类装饰器通过可以作为混入mixin和元类等高级技术的一种简介的替代方案。

```python
In [54]: import types

In [55]: from functools import wraps

In [57]: class Profiled:
    ...:     def __init__(self, func):
    ...:         wraps(func)(self)
    ...:         self.ncalls = 0
    ...:     def __call__(self, *args, **kwargs):
    ...:         self.ncalls += 1
    ...:         return self.__wrapped__(*args, **kwargs)
    ...:     def __get__(self, instance, cls):
    ...:         if instance is None:
    ...:             return self
    ...:         else:
    ...:             return types.MethodType(self, instance)
    ...:

In [58]: @Profiled
    ...: def add(x, y):
    ...:     return x + y
    ...:
    ...:

In [60]: add(2,3)
Out[60]: 5

In [61]: add(3,4)
Out[61]: 7

In [62]: add.ncalls
Out[62]: 2
```

> 为静态方法和类方法添加装饰器时，要确保装饰器在`@classmethod`和`@staticmethod`之后（先是@classmethod和@staticmethod，然后是需要添加的装饰器）。
>
> 在类中使用多个装饰器，一定要注意顺序问题

## 装饰器在标准库的应用

### `functools.wraps`

在实现装饰器时，当装饰器作用于一个函数上，该函数的元信息如`__name__`、`__doc__`、注解和参数签名都会丢失。

```python
In [15]: def timethis(func):
    ...:     '''
    ...:     Decorator that report the execution time
    ...:     '''
    ...:     def wrapper(*args, **kwargs):
    ...:         '''
    ...:         wrapper doc
    ...:         '''
    ...:         start = time.time()
    ...:         result = func(*args, **kwargs)
    ...:         end = time.time()
    ...:         print(func.__name__, end-start)
    ...:         return result
    ...:     return wrapper
    ...:
    ...:
In [16]: @timethis
    ...: def count(n:int):
    ...:     '''
    ...:     Counts down
    ...:     '''
    ...:     while n > 0:
    ...:         n -= 1
    ...:
In [17]: count.__annotations__
Out[17]: {}

In [18]: count.__doc__
Out[18]: '\n        wrapper doc\n        '

In [19]: count.__name__
Out[19]: 'wrapper'

```

从上述代码中可以看出count函数的`__name__`、`__doc__`等一些元信息发生了变化。

在定义装饰器时，使用`functools.wraps`可以避免被装饰函数的元信息丢失。具体看如下程序：

```python
In [20]: def timethis(func):
    ...:     '''
    ...:     Decorator that report the execution time
    ...:     '''
    ...:     @wraps(func)
    ...:     def wrapper(*args, **kwargs):
    ...:         '''
    ...:         wrapper doc
    ...:         '''
    ...:         start = time.time()
    ...:         result = func(*args, **kwargs)
    ...:         end = time.time()
    ...:         print(func.__name__, end-start)
    ...:         return result
    ...:     return wrapper
    ...:
    ...:

In [21]: @timethis
    ...: def count(n:int):
    ...:     '''
    ...:     Counts down
    ...:     '''
    ...:     while n > 0:
    ...:         n -= 1
    ...:

In [22]: count.__name__
Out[22]: 'count'

In [23]: count.__doc__
Out[23]: '\n    Counts down\n    '

In [24]: count.__annotations__
Out[24]: {'n': int}
```

在使用了`functools.wraps`装饰器之后，可以通过属性`__wrapped__`直接访问原始的被装饰的函数。

`__wrapped__`属性能够让被装饰函数暴露其参数签名信息。

如果有多个装饰器时，访问`__wrapped__`属性的行为如下：

```python
In [38]: def deco1(func):
    ...:     @wraps(func)
    ...:     def wrapper(*args, **kwargs):
    ...:         print('deco 1')
    ...:         return func(*args, **kwargs)
    ...:     return wrapper
    ...:
    ...:

In [39]: def deco2(func):
    ...:     @wraps(func)
    ...:     def wrapper(*args, **kwargs):
    ...:         print('deco 2')
    ...:         return func(*args, **kwargs)
    ...:     return wrapper
    ...:
    ...:

In [41]: @deco1
    ...: @deco2
    ...: def add(x, y):
    ...:     return x + y
    ...:
    ...:

In [42]: add(2,3)
deco 1
deco 2
Out[42]: 5

In [43]: add.__wrapped__(2,3)
deco 2
Out[43]: 5

In [49]: add.__wrapped__.__wrapped__(2,3)
Out[49]: 5
```

在上述代码中，`add.__wrapped__`返回的是第一层装饰器装饰的函数；

如果有多个装饰器，需要访问对应次数`__wrapped__`属性，才能找到原始的被装饰的函数。

> 内置的装饰器`@staticmethod`和`@classmethod`有所不同，它们把原始函数存储在属性`__func__`中。

在wraps的源码中，通过调用`update_wrapper`函数来实现。`update_wrapper`源码如下：

```python
Signature: update_wrapper(wrapper, wrapped, assigned=('__module__', '__name__', '__qualname__', '__doc__', '__annotations__'), updated=('__dict__',))
def update_wrapper(wrapper,
                   wrapped,
                   assigned = WRAPPER_ASSIGNMENTS,
                   updated = WRAPPER_UPDATES):
    for attr in assigned:
        try:
            value = getattr(wrapped, attr)
        except AttributeError:
            pass
        else:
            setattr(wrapper, attr, value)
    for attr in updated:
        getattr(wrapper, attr).update(getattr(wrapped, attr, {}))
    # Issue #17482: set __wrapped__ last so we don't inadvertently copy it
    # from the wrapped function when updating __dict__
    wrapper.__wrapped__ = wrapped
    # Return the wrapper so this can be used as a decorator via partial()
    return wrapper

```

### `functools.lru_cache`

`lru_cache`装饰器用于实现备忘功能。它把耗时的函数的结果保存起来，避免传入相同的参数时重复计算。LRU（Least Recently Used, 最近使用）表明不会无限制增长。

### `functools.singledispatch`

singledispatch，用于实现函数重载。

## 参考

1. 流畅的Python

2. Python标准库
