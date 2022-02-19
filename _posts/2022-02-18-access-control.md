---
layout: post
title: "访问控制模型"
date: 2022-02-11
tag:
- 访问控制
- ABAC
comments: false
---

# 访问控制模型

访问控制是通过某种方式显示地准许或限制主体对客体的访问能力以及范围。
访问控制的核心是授权策略。授权策略是用于确定一个主题是否对客体拥有访问能力的一套规则。
在统一的授权策略下，得到授权的用户是合法用户；否则是非法用户。
访问控制模型是从访问控制的角度出发描述安全系统，建立安全模型的一种方法。

## 已有的访问控制模型

ACL、RABC、ABAC

### ACL

基于实体的访问控制

### RABC

基于角色的访问控制(RABC, role based access control)，在用户和权限之间引入角色的概念，
用户和角色之间是一对多的关系，角色和权限之间是一对多的关系。

在RBAC中，通过分配和取消角色完成用户权限的授予和取消，实现了用户和权限的逻辑分离。

RABC的安全性体现在：

+ 最小优先级
+ 职责分离：整体分为用户、角色、权限
+ 管理和访问分离
+ 抽象操作

基础的RABC对权限管理粒度太粗。因此RABC3增加了role分层和一些contraint。

由于RBAC中角色是静态的，当业务需求非常复杂时，会导致角色爆炸问题。

### ABAC

基于属性的访问控制(ABAC, attribute based access control)是目前在分布式环境使用较为频繁的模型。ABAC中有一些基础概念:
+ 属性：指实体或者key-value对。
+ 实体：subject
+ 资源：object
+ Operation：在object上做的事情
+ Environment Condition：操作或情景的上下文
+ Policy：一些逻辑判断条件，需要通过subject和object的属性以及Environment Condition来判断subject的请求是否有权限

ABAC由请求的实体、被访问的资源、访问方法和条件这些元素组成。
这些元素统一使用属性进行描述，属性将访问控制中对所有元素的描述统一起来，

ABAC的核心机制是，当某个请求发起时，将subject的属性、object的属性和environment condition作为输入，PEP(Policy Enforcement Point)负责获取规则，
PDP(Policy Decision Point)进行计算，最终判断该请求是否有权执行。

ABAC功能组件如图所示：


#### xacml，可扩展的访问控制描述语言

xacml提供了一种描述abac语义的方式，
XACML模型使用规则、策略、基于规则和策略的组合算法、属性（主体、资源或客体、操作和环境条件）、职责和建议等元素

#### NGAC，next generation access control

具体参考NIST的论文

### 三者之间的关系

根据进行访问控制使用的属性不同，ACL和RBAC可以看做是ABAC的特例

+ 当abac的属性是实体时，abac退化为acl；
+ 当abac的属性是角色时，abac退化为rbac。

因此，abac具有实现acl、rbac的能力

rbac适合粗力度的访问控制，abac适合细粒度的访问控制。

## 参考

1. [The RBAC96 Model](https://profsandhu.com/cs6393_s12/lecture-rbac96.pdf)
2. 李晓峰,冯登国,陈朝武,房子河. 基于属性的访问控制模型[J]. 通信学报.
3. [ABAC - 基于属性的访问控制 - 复杂场景下访问控制解决之道](https://blog.csdn.net/XiaoBeiTu/article/details/100773968)
4. [基于属性的访问控制（ABAC）定义与思考 ——ABAC的基本概念](https://www.freebuf.com/articles/network/286143.html)
5. 访问控制模型研究进展
