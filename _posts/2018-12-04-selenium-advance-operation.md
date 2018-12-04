---
layout: post
title: "selenium高级主题"
date: 2018-12-04
excerpt: "centos7 flask nginx uwsgi"
tag:
- Selenium
- Python
comments: true
---

Selenium的页面导航、元素定位等基本操作能够帮助我们完成自动化爬虫任务中80%的工作。如果你只是为了简单地完成自动化爬虫功能的实现，那么下面的内容你不需要阅读；如果你希望你写的爬虫程序的运行效率更高，你想要学习一些selenium代码实现技巧，强烈推荐您阅读一下，这部分内容会带你走进一个不一样的世界，你会发现：原来自动化爬虫的代码还能这样写？是的，这部分内容能够让你的代码实现更具魅力。

该高级主题涉及的知识点有：

+ 延时加载Dom元素：学会如何处理页面中元素的异步加载。
+ 行为链ActionChain：学会将多个相关联的操作进行链式处理。
+ WebDriver的架构以及内部实现：了解WebDriver是如何实现的，以及WebDriver提供的一些常用的接口。

### 延时加载页面

随着互联网的快速发展，以及HTML5、CSS3、ajax( Asynchronous Javascript And XML，异步 JavaScript和XML)、React、Vue等前端技术的快速更新，网站功能的实现趋于复杂化和多样化。然而，对于动态页面的异步加载，Ajax始终在前端技术实现中扮演着非常重要的角色，Ajax不仅提升了页面的响应效果，同时也提供了友好的用户体验。

用户在使用浏览器向服务端发起请求时，浏览器对服务端返回的信息进行解析和渲染，最终向用户呈现出可见的HTML页面。当我们使用selenium执行自动化爬虫任务时，我们只需要加载到希望定位的目标元素即可，完全没必要等到整个页面加载完毕。这样的话，在一定程度上能够降低页面的加载时间，从而提高爬虫程序的性能。例如，当使用selenium实现模拟登录功能时，我们只需要等到和登录相关的元素加载完毕之后，就可以进行登录操作；我们无需关注与登录无关的页面元素。

因为一个页面这种每个元素的加载时间有所不同，这就增加了定位元素的难度。对于这一类问题，我们可以通过等待操作来解决。但是，使用selenium来操作DOM中的某个元素，当元素不在DOM内时，selenium会抛出 ElementNotVisibleException异常。通过等待操作可以避免上述异常的出现，从而提高代码的执行效率。

> 注意：在使用selenium执行爬虫任务时，要尽可能避免selenium抛出异常。如果selenium抛出了一个无法处理的异常，只能重启selenium来执行爬虫任务时，这就增加了爬虫程序的复杂度，同时也降低了爬虫程序的性能。因此，我们要通过编写防御式代码来避免抛出异常。

Selenium 提供了两种等待操作——显式等待(Explicit Waits)和隐式等待(Implicit Waits)。

#### 显示等待（Explicit Waits）

Explicit Waits 等待某个给定的条件触发之后才进行下一步操作。基于WebDriverWait和ExpectedCondition，我们可以实现一种显示等待的方法，让编写的代码等待需要的加载时间即可。举个简单的例子，当我在等公交车去公司时，假定公交车在10分钟内到达公交站点的话，我就做公交车；否则，我坐出租车去公司。

注意：使用`time.sleep()`也是一种显示等待的实现方法。但是，time.sleep()函数只会等待给定的时间。然而，页面加载元素需要的时间和我们指定的时间通常是不同的，这样会导致两种结果：如果我们给定的时间过短的话，会导致selenium抛出异常；如果我们给定的时间过长的话，会导致程序等待过长的时间，导致程序性能的降低。最好的解决方法是让程序自己来决定需要等待多长时间，这样既不会让程序等待的时间过长，也能保证程序的正常运行。然而，`time.sleep()`这种显示等待的做法有利于我们在开发过程中进行代码调试。

代码实现如下：

```python
import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


CHROMEDRIVER_PATH = './chromedriver'  # chromedriver所在的目录
TIMEOUT = 5  # seconds


def main():
    driver = webdriver.Chrome(
        executable_path=CHROMEDRIVER_PATH
    )
    start = time.perf_counter()
    driver.get('https://www.baidu.com')
    try:
        element = WebDriverWait(driver, TIMEOUT).until(
            EC.presence_of_element_located((By.ID, 'su'))
        )
        print(element.get_attribute('value'))
        print('waiting time: {:d}s'.format(TIMEOUT))
        print('loading time: {:.2f}s'.format(time.perf_counter()-start))
    finally:
        driver.quit()


if __name__ == '__main__':
    main()

# Result:
# 百度一下
# waiting time: 5s
# loading time: 1.96s
```

代码解析：该代码指定timeout为5秒，如果`presence_of_element_located`函数在5秒内完成定位元素的操作，对应代码会立刻返回结果；否则抛出 TimeoutException 异常。

WebDriverWait类是在 selenium.webdriver.support.wait中实现的，其函数签名为：`class.selenium.webdriver.support.wait.WebDriverWait(driver, timeout, poll_frequency=0.5, ignore_exceptions=None)`，其中：
+ 参数driver是一个 已经创建好的WebDriver实例。
+ 参数timeout为给定的超时时间。
+ 参数poll_frequency表示调用的睡眠间隔，默认值为`0.5 s`。
+ 参数ignore_exceptions表示调用中可能发生的所有异常类组成的元组，默认值为`(NoSuchElementException, )`。

WebDriverWait类提供了until, until_not两个方法：`until(method, message="")`：以poll_frequency为时间间隔重复调用方法method，直到返回值不为False，或者到达超时时间，抛出超时异常；`unti_not(method, message="")`：与until方法类似，当返回值为False时，method调用结束，并将返回值返回。

对于Expected Conditions，selenium 提供了一些常用的预期条件，以下是 `selenium.webdriver.support.expected_conditions`提供的26种预期条件：
1. title_is：页面的标题是否等于给定的标题
2. title_contains：页面的标题是否包含给定的标题
3. presence_of_element_located：页面的DOM是否存在给定的element
4. url_contains：当前页面的URL是否包含给定的字符串
5. url_matches：当前页面的URL是否符合期望的pattern
6. url_to_be：当前页面的URL是否等于给定的URL
7. url_change：当前页面的URL是否不等于给定的URL，与url_to_be相反
8. visibility_of_element_located：判断给定的元素是否存在于页面的DOM且是可见的。
9. visibility_of：给定的element是否是可见的
10. presence_of_all_elements_located：页面中至少存在一个element
11. visibility_of_any_elements_located：页面中至少有一个element可见
12. visibility_of_all_elements_located：所有的elements都在页面中且是可见的
13. text_to_be_present_in_element：给定的文本是否在选中的element中
14. text_to_be_present_in_element_value：给定的文本是否在给定的element的属性value中
15. frame_to_be_available_and_switch_to_it：给定的frame是否可切换
16. invisibility_of_element_located：给定的元素即不可见也不存在于页面的DOM
17. invisibility_of_element：
18. element_to_be_clickable：给定的element是可见的且可操作，并能执行点击操作
19. staleness_of：等待直到elements不再依附于页面的DOM
20. element_to_be_selected：element可以选择
21. element_located_to_be_selected：定位到的element能被选中
22. element_selection_state_to_be：给定element是否被选中的状态
23. element_located_selection_state_to_be：定位的element是否是选中状态
24. number_of_windows_to_be：窗口的数据是否等于给定的值
25. new_window_is_opened：新窗口是否open
26. alert_is_present：警告窗口是否存在

除了上述给定的通用条件，还可以自定义新的条件。通过WebDriverWait类和expected_conditions模块中提供的通用条件可以实现高效的显式等待操作。

#### 隐式Waits（Implicit Waits）

当我们需要操作多个不能立即使用的element时，隐式等待可以让WebDriverWait轮询DOM指定的次数。这种操作方法的好处不太明显，推荐的做法：在写代码之前，认真地分析要操作的对象，根据操作的DOM对象的数量来决定是使用显示等待还是隐式等待。

代码实现：
```python
from selenium import webdriver


CHROMEDRIVER_PATH = './chromedriver'


def main():
    driver = webdriver.Chrome(
        executable_path=CHROMEDRIVER_PATH
    )
    driver.implicitly_wait(10)
    driver.get('https://www.baidu.com')
    dynamic_element = driver.find_element_by_id('su')
    print(dynamic_element.get_attribute('value'))


if __name__ == '__main__':
    main()
```

代码解析：implicitly_wait函数的签名为：`implicitly_wait(self, time_to_wait)`，该函数设定timeout值，隐式等待期望的DOM元素被发现，或者Command执行完成。每次建立会话时，该方法只执行一次。关于会话的概念，在第3小节会进行介绍。

#### 行为链Action Chains

Action Chains用于完成简单的交互行为，例如，鼠标移动，鼠标点击，键盘输入等事件。这对于模拟较复杂的连续性操作非常有用，如验证码的滑动，其中涉及到鼠标点击、鼠标悬停和拖拽行为等事件。

在ActionChains对象上调用的一系列方法，类似于用户的一系列连续的操作，这些行为存储在一个队列里。当调用perform()时，这些动作依次出队并执行。

ActionChains类提供的方法如下：
+ perform()：执行所有存储的行为
+ reset_action()：将存储的行为置为空
+ click()：执行点击操作
+ click_and_hold()：在元素上点击鼠标左键并保持不动
+ context_click()：在元素上点击右键
+ double_click()
+ drag_and_drop
+ drag_and_drop_by_offset
+ key_down
+ key_up
+ move_by_offset
+ move_to_element
+ move_to_element_with_offset
+ pause
+ release
+ send_keys
+ send_keys_to_element

ActionChain类实现了`__enter__`和`__exit__`方法，所以ActionChain类是一个上下文管理器对象。

### WebDriver常用的API

在本节介绍一下WebDriver常用的API以及RemoteDriver，ChromeDriver，对于其他浏览器driver的相关操作，可以查看Python版的selenium文档进行学习。

#### selenium的架构以及核心组件

从Client/Server的角度来看，selenium扮演Server的角色。在客户端与服务器进行通信的过程中，二者需要按照一定的协议进行交互，才能完成信息的传递。

selenium中所有与browser通信的WebDriver都实现了一种通用的协议--Json Wire Protocol，该协议定义了基于HTTP的RESTful Web service，其中，Json作为信息交换的媒介。该协议假设客户端实现采用一种面向对象的方法。该协议中，request/response的实现对应于commands/responses。

在 Json Wire Protocol 中，有一些基本术语和概念：
+ 客户端：使用WebDriver API的机器；通常客户端和服务器在一台主机上
+ 服务器：实现wire 协议的浏览器，如FirefoxDriver或IPoneDriver等等。
+ Session：服务器保证每个浏览器对应一个session，发送给会话的Command将直接作用于对应的浏览器，完成Command对应的操作，并返回teding的JSON响应消息。
+ WebElement：WebDriver API中的对象表示页面上的DOM element
+ WebElement JSON Object：在wire上传输的WebElement的JSON表示
+ Commands：WebDriver的Command消息符合`HTTP/1.1 request specification`，wire 协议规定，所有的 commands 接收 `application/sjon;charset=UTF-8`的内容。在WebDriver服务中，每个命令可以映射到特定路径上的一个HTTP方法。
+ Responses：responses 应该按照`HTTP/1.1 response messages`规范来发送。

上述是一些我认为比较重要的概念，有助于我们深入理解selenium的代码实现。关于Json Wire Protocol的具体实现，可参考链接2。

#### RemoteWebDriver

RemoteWebDriver是所有浏览器WebDriver的基类。通过学习RemoteWebDriver的实现，我们可以深入了解其他浏览器WebDriver。
RemoteWebDriver对象的实现类为：selenium.webdriver.remote.webdriver.WebDriver。RemoteWebDriver的实现符合Json Wire Protocol，并为用户提供了多种便于使用的接口来控制浏览器，完成用户需要完成的操作。

以RemoteWebDriver为基类，selenium根据不同的浏览器实现对应不同的浏览器driver，如下代码是selenium提供的所有浏览器驱动：
```python
In [1]: from selenium import webdriver

In [2]: webdriver.remote.webdriver.WebDriver.__subclasses__()
Out[2]:
[selenium.webdriver.firefox.webdriver.WebDriver,
 selenium.webdriver.chrome.webdriver.WebDriver,
 selenium.webdriver.ie.webdriver.WebDriver,
 selenium.webdriver.edge.webdriver.WebDriver,
 selenium.webdriver.safari.webdriver.WebDriver,
 selenium.webdriver.blackberry.webdriver.WebDriver,
 selenium.webdriver.phantomjs.webdriver.WebDriver,
 selenium.webdriver.android.webdriver.WebDriver,
 selenium.webdriver.webkitgtk.webdriver.WebDriver]

In [3]: webdriver.Remote
Out[3]: selenium.webdriver.remote.webdriver.WebDriver

In [4]: webdriver.Chrome.__base__
Out[4]: selenium.webdriver.remote.webdriver.WebDriver
```

如果需要定制化WebDriver时，可以参考Chrome等浏览器驱动的实现。

#### ChromeDriver

ChromeDriver是以chrome浏览器提供的`chromedriver`为基础，遵循JSON Wire Protocol，为Python开发者提供的接口实现。ChromeDriver对象的具体实现为
```
class selenium.webdriver.chrome.webdriver.WebDriver(*executable_path='chromedriver'*, *port=0*, *options=None*, *service_args=None*, *desired_capabilities=None*, *service_log_path=None*, *chrome_options=None*)
```
该类允许控制browser，并创建ChromeDriver的一个对象。该类的基类为RemoteWebDriver。其中：
*executable_path*参数表示chromedriver所在的路径，默认情况下，会在`$PATH`进行查找；
+ *port* 参数表示服务运行的端口；
+ 如果*chrome_options* 存在，*options = chrome_options*；
+ *desired_capabilities*：Dictionary object with non-browser specific capablilities；
+ `service_log_path`：driver生成的log信息存放的路径；
+ `keep_alive`：是否配置ChromeRemoteConnection使用`HTTP keep-alive`；
+ DesiredCapabilities类提供了selenium默认支持的`desired capablities`，
ChromeOption对象的实现类为`class selenium.webdriver.chrome.options.Options`，用来配置Chrome的扩展以及`headless`状态。

在进行自动化爬虫，通常会采用`headless`状态的浏览器模式来提高程序的性能。

#### 参考

1. [https://selenium-python.readthedocs.io/https://selenium-python.readthedocs.io/](https://selenium-python.readthedocs.io/https://selenium-python.readthedocs.io/)
2. [https://github.com/SeleniumHQ/selenium/wiki/JsonWireProtocol](https://github.com/SeleniumHQ/selenium/wiki/JsonWireProtocol)
3. [https://selenium-python-docs-zh.readthedocs.io/zh_CN/latest/](https://selenium-python-docs-zh.readthedocs.io/zh_CN/latest/)
4. [https://seleniumhq.github.io/selenium/docs/api/py/api.html](https://seleniumhq.github.io/selenium/docs/api/py/api.html)

