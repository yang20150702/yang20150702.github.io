---
layout: post
title: "单向散列函数"
date: 2018-05-15
excerpt: "单向散列函数及Python标准库hashlib "
tag:
- python
- hash
comments: true
---

单向散列函数，又称消息摘要函数、哈希函数或者杂凑函数。

### 定义


单向散列函数是一种采集文件指纹的技术。单向散列函数所生成的散列值，相当于消息的指纹。

单向散列函数可以根据消息的内容计算出散列值，散列值可以用来检查消息的**完整性**。

其中，消息可以是文字、文件、图片等等。散列值的长度与消息的长度无关，散列值的长度通常是固定的。

单向散列函数的性质：

1. 根据任意长度的消息计算出固定长度的散列值；

2. 能够快速计算出散列值；

3. 消息不同散列值也不同。

4. 具备单向性（单向性是指无法通过散列值反算出消息的性质）

    > 碰撞是指不同消息通过单向散列函数产生同一个散列值的情况。
    强抗碰撞性是指要找到散列值相同的两条不同的消息是非常困难的
    弱抗碰撞性为：当给定某条消息的散列值时，单向散列函数必须确保要找到和该条信息具有相同散列值的另外一条消息是非常难的。
    注意二者的区别，弱抗碰撞性是已知一条消息的散列值；而强抗碰撞性只知道一个散列值。

单向散列函数都需要具备弱抗碰撞性和强抗碰撞性。

# 应用场景

1. 检查软件是否被篡改

2. 用于基于口令的加密方式(PBE)

   PBE的原理：将口令和盐(salt, 随机值)混合后计算其散列值，然后将这个散列值用作加密的密钥。

3. 消息认证码

4. 数字签名

5. 伪随机数生成器

6. 一次性口令

## 现有的单向散列函数

1. MD4, MD5

   MD5能够产生128比特的散列值。目前MD5的强抗碰撞性已经被攻破。

2. SHA-1, SHA-256, SHA-384, SHA-512

   这些函数都是由NIST(美国国际标准技术研究所)设计的。其中，SHA-1产生160比特的散列值，其强抗碰撞性已于2005年被攻破。

   SHA-256, SHA-384, SHA-512统称为SHA-2。

3. AHS和SHA-3

## Python中单向散列函数的实现

在Python3中，标准库hashlib提供来安全的hash和消息摘要。

hashlib中实现了 SHA1, SHA224, SHA256, SHA384, and SHA512 (defined in FIPS 180-2) as well as RSA’s MD5 algorithm (defined in Internet [**RFC 1321**](https://tools.ietf.org/html/rfc1321.html)).

每种hash算法都有对应的构造方法。

> 为了获得更好的多线程性能，当数据大于2047字节时，在对象创建和update操作时，解释器会释放GIL。

例子：

```  python
In [44]: import hashlib

In [45]: m = hashlib.sha256()

In [46]: m.update(b"this a test")

In [47]: m.update("in Python".encode(encoding='utf-8'))

In [48]: m
Out[48]: <sha256 HASH object @ 0x7efcf7c55f08>

In [49]: m.digest()
Out[49]: b'\x10\x1f,\x10\xc70\x80\xdb\xc9\xef\ne\x9e1\xfdJ\xfa\xa2\x15\xcb\x15T\xeb+r\xfbYSd"o\x94'

In [50]: m.digest_size
Out[50]: 32

In [51]: m.block_size
Out[51]: 64
```

hashlib中的函数：

1. `hash.new(name[, data])`：接受一个要使用的算法的字符串作为name值的基本构造函数。new()可以使用OpenSSL提供的算法。

2. `hash.update(data)`：使用字节对象来update哈希对象。

3. `hash.digest()`：返回数据的摘要，是大小为digest_size的字节对象

3. `hash.hexdigest()`：返回字符串对象，其中只包含十六进制数字。可用于在电子邮件或者其他非二进制环境中安全地交换值。

## 参考

1. 图解密码技术
