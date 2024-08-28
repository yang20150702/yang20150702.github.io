---
layout: post
title: "Torchelastic agent and user worker failover 故障转移约定"
date: 2024-08-28
tag:
- 分布式计算架构
- training-operator
- pytorch
comments: false
---

> 本文翻译自pytorch源码中torch.distributed.elastic包： [github地址](https://github.com/pytorch/pytorch/blob/main/torch/distributed/elastic/__init__.py)

Torchelastic agent 和 user worker故障转移合约：

**TL;DR;**:

+ TE(torchelastic) 期望 user workers 在 5 分钟内完成漂移(drift)
+ 最好将 DDP app 设计为所有workers都失败，而不是单个worker失败
+ TE 不会同步agent之间的重启次数
+ TE re-rendezvous(会合) 不会触发重启减少
+ 当单个 agent 完成其工作（不论成功或失败）时，它将关闭 rendezvous。 如果其他 agent 仍有 workers 在进行中，它们将被终止。
+ 基于上述描述，如果至少有一个 agent 完成了工作，则 scale down 不起作用。
+ 当 agents 检测到 scale up 时，它不会减少 `max_restarts`

通常，TE(torchelastic) 可以启动任意用户代码，但需要澄清 torchelastic 提供的故障转移机制以及它期望 user workers 提供的故障转移机制。

TE 目前支持 DDP 形式应用，这意味着 TE 期望 *所有* workers 大致同时完成。实际上，几乎不可能保证任意 DDP 应用程序中的所有 workers 同时完成，
因此 TE 提供了一个结束屏障(finalization barrier)，等待 TIMEOUT（5 分钟）以完成工作。

**Worker 失败**

当 worker 失败时，TE 将检查可用的重启次数，如果重启次数超过 0 次，TE 将开始新的rendezvous轮次并重新启动 worker 进程。新的rendezvous轮次将使其他 TE agent 终止其workers。

> 注意：TE 代理不会在它们之间同步重启。当单个agent执行重启时，它将减少本地 `max_restarts`减少，其他代理不会减少其 `max_restarts`。用户在开发主机上本地运行分布式应用程序。

单个 worker 故障可能导致整个集群故障：如果单个 worker 持续故障，将导致 TE 代理 `max_restarts` 变为零。这将导致代理完成其工作并关闭 rendezvous。如果其他 agent 上有其他工作进程，它们将被终止。

**Re-Rendezvous**

当 TE 代理检测到新节点试图加入集群时，会发生重新rendezvous。TE 不会减少“max_restarts”。TE 代理将终止其工作程序并开始新的 rendezvous 轮次。

关于 DynamicRendezvous（etcd-v2、c10d-experimental）的注意事项：如果 rendezvous 已经有 max_nodes，则新节点不会立即添加到等待列表中，
因为没有必要下线已经充分利用的 rendezvous。新节点将等待，直到超时（默认为 600 秒）并定期检查参与者的数量。如果数量小于 max_nodes，它将被添加到等待列表中；否则，它将在 600 秒后超时。

*scale up event*。当扩容事件发生时，torchelastic rendezvous 将检测到有新节点试图加入。Torchelastic agent 将停止所有工作程序并执行重新 rendezvous。注意：当扩容事件发生时，*``max_restarts``* 将*不会*减少。

*scale down event*。当缩容事件发生时，rendezvous 不会通知 torchelastic 代理。如果 TE 代理使用 ``max_restarts=0`` 启动，它依赖底层调度程序来处理作业重启。
如果 ``max_restarts>0`` ，TE 代理将终止工作程序并开始新的 rdzv 轮次，这是一个 *扩容事件*。

## 总结

本文介绍了TE agent 和 worker在发生故障转移时的一些约定，这些约定可以确保整体agent和workers运行的可预测性和弹性。