---
layout: post
title: "功能测试"
date: 2016-07-13 21:29
excerpt: "Django测试驱动开发"
tag:
- Django
- Python
---

## 功能测试

### 定义

驱动真正的网页浏览器，让我们能从用户的角度查看应用是如何运作的，我们把这类测试叫做功能测试。

### 作用

跟踪“用户动作”， 模拟用户使用某个功能的过程，以及应用应该如何响应用户的操作。

> **功能测试=验收测试=端到端测试**

+ 功能测试：这类测试最重要的作用是从外部观察整个应用是如何运作的。

+ 黑箱测试：这种测试对所要测试的系统内部一无所知。

## 如何实现功能测试

功能测试应该有一个人类可读、容易理解的故事，为了叙述清楚，可以把测试代码和代码注释结合起来使用。编写新功能测试时，可以先写注释，勾勒出用户故事的重点。这样写出的测试人类可读。

### Python标准库中的`unittest`模块

{% highlight Python %}
from selenium import webdriver
import unittest

class NewVisitorTest(unittest.TestCase):

    def setUp(self):
        self.browser = webdriver.Firefox()

    def tearDown(self):
        self.browser.quit()

    def test_can_start_a_list_and_retrieve_it_later(self):
        self.browser.get('http://localhost:8000')

        self.assertIn('To-Do', self.browser.title)
        self.fail('Finish the test')

if __name__ == '__main__':
    unittest.main(warnings='ignore')
{% endhighlight %}

> 注意

1. 测试组织成类的形式，继承自`unittest.TestCase`

2. 名字以`test\_`开头的方法都是测试方法，由测试程序运行。类中可以定义多个测试方法。

3. `setUp`和 `tearDown`是特殊的方法，分别在各个测试方法之前和之后运行。

4. 不管怎样，`self.fail`都会失败，生成指定的错误消息。

5. `warning='ignore'`的作用是禁止抛出`ResourceWarning`异常。

6. 如果`setUp`方法抛出异常，则`tearDown`方法不会运行。

## 有用的TDD概念

* 用户故事

  从用户的角度描述应用应该如何运行。用来组织功能测试。

* 预期失败

  意料之中的失败
