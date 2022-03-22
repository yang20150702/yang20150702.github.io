---
layout: post
title: "rust中，str vs String以及self vs Self的区别"
date: 2022-03-18
tag:
- rust
comments: false
---

## str与String之间的区别

String是在heap上动态分配的字符串类型，类似 Vec；使用场景：当你需要拥有或修改字符串数据时。

str 是 UTF-8字节的不可变序列，内存中长度可变。因为str的大小是未知的，你只能通过指针来操作str。这意味着str通常以`&str`出现：表示指向UTF-8数据的引用；通常也称为`string slice`或者仅仅是`slice`。`slice`仅仅是一些数据的视图，这些数据可以出现在任意地方。

+ 在静态存储中：字符串是`&'static str`。数据被硬编码到可执行文件中，当程序运行时加载到内存中。
+ 在heap上分配的String：String指`String数据的 &str view的去引用`。
+ 在stack上：可以创建在stack分配的字节数组，然后获取数据的view作为`&str`
```
use std::str;
#[test]
fn test_stack_allocated_str() {
    let x: &[u8] = &[b'a', b'b', b'c'];
    let stack_str: &str = str::from_utf8(x).unwrap();
    println!("stacked_str: {}", stack_str);
}
```

总结：如果你需要拥有字符串的所有权（比如传递string到其他线程中，或者在运行时构建string），可以使用String。如果你需要一个字符串的引用，可以使用`&str`。

这类似于`Vec<T>`和切片`&[T]`之间的关系，也类似于 基本类型的值`T`和`&T`的引用之间的关系。

## self与Self之间的区别


方法参数中的`Self`是一种语法糖，表示方法的接收者类型。

`Self`可能出现在`trait`或者`impl`，但是更多出现在`trait`，它是最终实现`trait`的任何类型的占位符（类型在定义`trait`是未知的）

```
pub strait Clone {
    fn clone(&self) -> Self
}
```

`&self`是`trait`或者`impl`中某个方法的第一个参数。也可以使用其他命名，然而，这里有明显不同：

+ 如果使用`self`，实现的函数是一个方法
+ 如果使用其他命名，实现的函数是一个关联函数

当`self`作为方法的第一个参数时，是`self: Self`的简写。类似，`&self`等价于`self: &Self`；`&mut self`等价于`self: &mut Self`

## 参考

1. [string vs str in rust](https://stackoverflow.com/questions/24158114/what-are-the-differences-between-rusts-string-and-str)
