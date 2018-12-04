---
layout: post
title: "Python中的数据库驱动安装"
date: 2016-07-15
excerpt: ""
tag:
- Python
- 数据库
---

# how to install db by pip in ubuntu14.04

## 环境

Ubuntu14.04 ，virtual-env

## 操作


## how to install psycopg2

`pg_config is in postgresql-devel (libpq-dev in Debian/Ubuntu)`

错误信息: `pg_config executable not found`

### 解决方法

```
sudo apt-get install libpq-dev
pip install psycopg2
```

##  how to install pyodbc

错误信息: `No such fiel or directory # include <sql.h>`

### 解决方法

```
sudo apt-get install unixodbc-dev
pip install pyodbc
```

## how to install mysqldb

错误信息: `EnvironmentError: mysql_config not found`

### 解决方法

```
sudo apt-get install libmysqlclient-dev
pip install MySQL-python
```
