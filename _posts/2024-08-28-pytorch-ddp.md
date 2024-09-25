---
layout: post
title: "Pytorch DDP分布式数据并行训练"
date: 2024-09-25
tag:
- 模型训练
- DDP
- pytorch
comments: false
---


通过理解DDP分布式数据并行策略，来了解上层的算法和底层的计算之间是如何进行交互的

pytorch的并行策略实现对应三种不同的实现
+ `torch/nn/parallel/distributed.py`: DistributedDataParallel
+ `torch/distributed/fsdp`：FSDP
+ `torch/distributed/pipelining`：流水线并行，模型并行，张量并行

## DistributedDataParallel实现

> 参考：[DistributedDataParallel文档](https://pytorch.org/docs/stable/generated/torch.nn.parallel.DistributedDataParallel.html#torch.nn.parallel.DistributedDataParallel)

DistributedDataParallel文档中有**一些关于用法和原理的注意事项，推荐在使用之前详细阅读**。

DistributedDataParallel 是基于`torch.distributed`实现模块级别的分布式数据并行。
DistributedDataParallel 通过在每个模型副本之间同步梯度来提供数据并行性。
DistributedDataParallel不会在 GPU 之间对输入进行分块或以分片；用户负责定义如何执行此操作，例如通过使用DistributedSampler。

DistributedDataParallel有两种实现方式：
+ 基于分布式RPC框架实现
+ 直接基于通信原语进行实现：默认实现

```
class DistributedDataParallel(Module, Joinable):
```
DistributedDataParallel直接复用了 `nn.Module`的train方法，整体训练流程应该是在 `forward()`前后增加一些DDP逻辑。

`Joinable`抽象类提供了并行管理模型训练进程的能力。具体用法如下：


