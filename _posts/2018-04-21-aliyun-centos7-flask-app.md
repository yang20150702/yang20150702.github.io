---
layout: post
title: "在阿里云服务器(centos7)使用uwsgi+nginx搭建flask应用环境"
date: 2018-04-20
excerpt: "centos7 flask nginx uwsgi"
tag:
- Linux
- Flask
- Python
- uwsgi
- nginx
comments: true
---
首先，关闭阿里云防火墙。

## Python基础环境安装以及依赖安装

安装Python3的环境，注意要先用yum安装Python3需要的依赖。

用pip安装flask应用依赖

## 使用uwsgi部署flask应用

uwsgi是最流行的uWSGI服务器。而WSGI是一个协议，它规定了一种在Web服务器与Web应用程序/框架之间推荐的标准接口，确保Web应用程序在不同的Web服务器之间具有可移植性。


```
pip install uwsgi
```


建立uwsgi.ini文件，输入如下内容：


```
[uwsgi]
socket = 127.0.0.1:8080
pythonpath = project_path;
module = uwsgi    // 启动文件名
callable = app    //启动文件中的Flask对象app
processes = 4
threads = 2
```

运行`uwsgi uwsgi.ini`，来测试uwsgi的配置是否正确。如果报错，重新检查。

使用httpie来测试接口。

[HTTPie](https://github.com/jakubroztocil/httpie) 是一个命令行HTTP客户端。 其目标是使 CLI 与 Web 服务的交互尽可能人性化。 它提供了一个简单的http 命令，允许使用简单而自然的语法发送任意HTTP请求，并显示彩色输出。 HTTPie 可用于测试，调试以及通常与HTTP服务器进行交互。

`pip install httpie`

执行`http http://127.0.0.1:8080`，即可看到返回的内容。

## 安装Web服务器nginx

用Python语言开发的应用使用的Web服务器主要有Nginx、Apache. 这里，选择使用Nginx作web服务器。

yum install nginx

修改nginx配置文件，`vim /etc/nginx/nginx.conf`

```
server_name 服务器外网IP;

location / {
                include        uwsgi_params;
                uwsgi_pass     127.0.0.1:8080;
                uwsgi_param UWSGI_PYHOME python_dir;
                uwsgi_param UWSGI_CHDIR project_path;
                uwsgi_param UWSGI_SCRIPT uwsgi:app; //创建uwsgi.py文件，导入Flask对象app
        }


```

执行 `nginx` 命令，启动nginx。

## Question

Web服务器和应用服务器的区别：

+ Web服务器负责处理HTTP协议，应用服务器既可以处理HTTP协议，也可以处理其他协议，如RPC。

+ Web服务器用于处理静态页面的内容，对于脚本语言生成的动态内容，它通过WSGI接口交给应用服务器来处理。

+ 一般应用服务器都集成了Web服务器。处于性能和稳定行考虑，应用服务器不能在生产环境中使用。


1. 如果运行nginx或者uwsgi时，出现端口占用，可以执行命令`killall -9 uwsgi`来杀掉对应的进程。

2. `netstat -plant`查看uwsgi网络连接情况。

3. 为什么要用nginx+uwsgi组合使用？

部署Flask应用时，通常使用一种WSGI应用服务器搭配Nginx，Nginx作为反向代理。

### 正向代理和反向代理

正向代理，作为一个媒介将互联网上获取的资源返回给相关联的客户端。代理和客户端在一个局域网，对于服务端是透明的。

反向代理：根据客户端的请求，从后端的服务器上获取资源，然后再将这些资源返回给客户端。代理和服务器在一个局域网，对客户端透明。

Nginx是反向代理的最佳选择，反向代理的作用：

1. 提高动态语言的I/O处理能力，Python等动态语言的I/O处理能力不高，反向代理可以缓冲请求，交给后端一个完整的HTTP请求，同样，Nginx也可以缓冲响应，也达到减轻后端的压力。

2. 加密和SSL加速

3. 安全。它保护和隐藏原始资源服务器，可以用作应用防火墙防御一些网络攻击，如DDos。

4. 负载均衡。它能帮助应用服务器分配请求，以达到资源使用率最佳、吞吐率最大、响应 时间最小的目的。

5. 缓冲静态内容。代理缓冲可以满足相当数量的网站请求，大大降低应用服务器上的负载。

6. 支持压缩。通过压缩优化可以提高网站访问速度，还能大大减少带宽的消耗。

### Nginx配置

Nginx配置文件是以块的形式组织的。每个块以一对花括号来表示，主要有 6 种块。

+ main: 全局设置，包含一些Nginx的基本控制功能。它在配置的顶层，内部包含events, http两种块。

+ server: 事件设置，控制Nginx处理连接的方式

+ http: HTTP设置，在它的内部包含server和upstream

+ server: 主机配置

+ upstream: 负载均衡设置

+ location: URL模式设置，在server层之下。server可以包含多个location块

具体的负载均衡算法，可以从官方文档获取。

## 参考

1. http://www.simpleapples.com/2015/06/11/configure-nginx-supervisor-gunicorn-flask/

2. http://docs.jinkan.org/docs/flask/deploying/uwsgi.html

3. Python Web开发实战(董伟明)
