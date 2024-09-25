---
layout: post
title: "Pytorch DeviceMesh"
date: 2024-08-28
tag:
- 分布式计算架构
- training-operator
- pytorch
comments: false
---

DeviceMesh想要解决什么样的问题。

DeviceMesh 是管理进程组（或 NCCL ）的更高级别的抽象。它允许用户轻松创建节点间和节点内进程组，而无需担心如何为不同的子进程组正确设置rank，
并且它有助于轻松管理这些分布式进程组。init_device_mesh()函数可用于创建新的 DeviceMesh，其网格可描述设备拓扑。

DeviceMesh 可用于描述整个集群中的设备布局，并作为集群内设备列表之间通信的代理。DeviceMesh通常作为一个上下文管理器

DeviceMesh 遵循 SPMD 编程模型，这意味着集群中的所有进程rank都运行相同的 PyTorch 程序。
因此，用户需要确保 所有ranks的网格阵列（描述设备的布局）应相同。不一致的mesh会导致静默挂起。

