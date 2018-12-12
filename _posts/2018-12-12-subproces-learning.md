---
layout: post
title: "subprocess: 子进程管理"
date: 2018-12-12
tag:
- Python
comments: true
---


`subprocess`模块允许创建新的进程，连接它们的input/output/error，并得到returncode.
该模块用来替换老的模块和函数。

## 核心API的实现

subprocess模块有1500行代码，同时提供了核心API：`run()`和`Popen()`：
+ run(): 运行command，等待它执行完成，然后，返回一个CompletedProcess实例
+ Popen(): 用于在一个新进程中执行command的类

还有常量：
+ DEVNULL: 表示使用`os.devnull`的特殊值
+ PIPE:    表示创建一个pipe的特殊值
+ STDOUT:  表示stderr重定向到stdout的特殊值

> 一般情况，subprocess文档推荐使用`run()`来创建子进程。

### run()

函数实现为：
```python
from subprocess import Popen, PIPE, TimeoutExpired, CalledProcessError, CompletedProcess
def run(*popenargs, input=None, timeout=None, check=False, **kwargs):
    """Run command with arguments and return a CompletedProcess instance.

    The returned instance will have attributes args, returncode, stdout and
    stderr. By default, stdout and stderr are not captured, and those attributes
    will be None. Pass stdout=PIPE and/or stderr=PIPE in order to capture them.

    **kwargs are the same as for the Popen constructor.
    """
    if input is not None:
        if 'stdin' in kwargs:
            raise ValueError('stdin and input arguments may not both be used.')
        kwargs['stdin'] = PIPE

    with Popen(*popenargs, **kwargs) as process:
        try:
            stdout, stderr = process.communicate(input, timeout=timeout)
        except TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
            raise TimeoutExpired(process.args, timeout, output=stdout,
                                 stderr=stderr)
        except:
            process.kill()
            process.wait()
            raise
        retcode = process.poll()
        if check and retcode:
            raise CalledProcessError(retcode, process.args,
                                     output=stdout, stderr=stderr)
    return CompletedProcess(process.args, retcode, stdout, stderr)
```

对于大多数用法，run和Popen中的许多参数可以保留默认的参数。最常用的参数如下：
+ args：字符串或参数列表；如果传递的是字符串，shell=True；
+ stdin, stdout, stderr：分别表示程序的标准输入、输出和错误的文件句柄；有效值
  为：PIPE, DEVNULL, 文件对象和None；
+ 如果未使用文本模式，输入中的行结束符`\n`将转换为默认分隔符`os.linesep`；
+ shell=True，将通过shell执行指定的命令，可以使用shell提供的高级功能：shell管道、
  文件名通配符等等。

### Popen类

subprocess模块的基础功能是由`Popen`类来实现。`Popen`类的函数签名如下：
```
Init signature:
Popen(args, bufsize=-1, executable=None, stdin=None, stdout=None, stderr=None,
      preexec_fn=None, close_fds=<object object at 0x7f9f7a34a1a0>, shell=False,
      cwd=None, env=None, universal_newlines=False, startupinfo=None, creationflags=0,
      restore_signals=True, start_new_session=False, pass_fds=(), *,
      encoding=None, errors=None)
```
Popen类中实现了`__enter__`, `__exit__`方法，在`__exit__`方法中关闭打开的文件描述符，
并等待子进程执行完毕。因此，Popen类是上下文管理器对象。
因为subprocess是用于在操作系统中创建子进程的，因此，其中的一些函数提供两类实现：POSIX, Windows。

Popen类提供的函数如下：
+ poll()：检查子进程是否终止，设置并返回returncode属性
+ wait(timeout=None)：等待子进程终止，设置并返回returncode属性
+ communicate(input=None, timeout=None)：进程间通信：发送数据到stdin，
  从stdout和stderr中读取数据。返回元组`(stdout_data, stderr_data)`
+ `send_signal(signal)`：向子进程发送信号signal
+ terminate()：停止子进程
+ kill()
+ 属性：args, stdin, stdout, stderr, pid(子进程的ID), returncode

### 其他函数

1. list2cmdline(seq)：将参数序列翻译为命令行字符串
2. getstatusoutput(cmd)：获取命令执行的returncode和data，cmd为字符串，默认shell=True
2. getoutput(cmd)

## 使用案例

假设，我想通过Python来执行一条shell命令，要求：
+ 该命令的执行的时间比较长
+ 确保该命令能够执行成功，通过returncode来判断

具体实现如下：
```python
import subprocess
from shlex import split

def execute(cmd):
    p = subprocess.Popen(split(cmd))
    if p.poll() is None:  # 当子进程执行完毕时，会返回returncode=0
        p.wait()  # 显示等待进程结束

def execute_with_run(cmd):
    p = subprocess.run(split(cmd))
    if p.returncode == 0:
        print('execute successfully!')

```
上述代码采用了两种不同的实现方法。
