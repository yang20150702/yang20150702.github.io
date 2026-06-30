---
layout: post
title: "强化学习推理尾延迟全栈根因分析（上）：现象、架构与系统层诊断"
date: 2026-06-30
tag:
- vllm
comments: false
mathjax: true
---

> 本文围绕强化学习训练采样模块中观测到的推理尾延迟现象，通过穿透应用层（Ray + SHM 通信）和系统层（Linux NUMA / CPU 亲和性）进行根因分析。

---

## 摘要

本文围绕强化学习训练采样模块中观测到的推理尾延迟现象（`p999_deschedule_ms` 在 VMware + `rt_runtime_us=500000` 下飙升至 400-470ms，而同一 VMware 环境在理想配置（`rt_runtime_us=950000` + SCHED_FIFO 可用）下仅为 0.02ms，差距达 4 个数量级）进行全栈根因分析。

通过穿透 **应用层（Ray + SHM 通信）→ 系统层（Linux NUMA / CPU 亲和性）→ 微架构层（Cache / MESI）→ 虚拟化层（VMware 拓扑欺骗）** 四层，揭示尾延迟的物理根因不是单一因素，而是**主动穿透抽象的紧密依赖与抽象泄漏的交叉放大**——应用层为性能主动穿透 Ray/Linux 抽象（SHM 通信、CPU 亲和性），而虚拟化层的承诺失信（拓扑欺骗、co-scheduling 互锁）使这些优化手段的基础被破坏，两者叠加产生 4 个数量级的延迟放大。最终给出弃 VMware 走裸金属 + K8s 的迁移论证与验证指标。

---

## 术语表

| 术语 | 全称/解释 |
|------|----------|
| RL | 强化学习 (Reinforcement Learning) |
| SL | 监督学习 (Supervised Learning)，行为策略模型 |
| Actor | 采样执行单元，运行环境仿真与推理 |
| Learner | 训练单元，执行梯度更新 |
| SHM | 共享内存 (Shared Memory)，进程间零拷贝通信 |
| NUMA | 非一致性内存访问 (Non-Uniform Memory Access) |
| Socket | CPU 物理插槽，一颗物理 CPU 的安装位 |
| CCD | Core Complex Die，Zen 4 架构的计算单元（8 核 + 32MB L3） |
| IOD | I/O Die，集成内存控制器与 Infinity Fabric 互连 |
| xGMI | 跨 Socket 互连总线（跨 CPU 插槽通信链路） |
| MESI | 缓存一致性协议（Modified/Exclusive/Shared/Invalid） |
| CFS | 完全公平调度器 (Completely Fair Scheduler) |
| SCHED_FIFO | Linux 实时调度策略（先入先出） |
| deschedule | 线程被换出 CPU 的空窗时间 |
| p999 | 99.9% 分位延迟，尾部极端值 |
| first-touch | Linux 内存分配策略：物理页落在首次访问的 CPU 所在 NUMA 节点 |
| co-scheduling | VMware vCPU 协同调度机制 |
| Ray | 分布式计算框架 |
| K8s | Kubernetes 容器编排平台 |
| vCPU/pCPU | 虚拟 CPU / 物理 CPU |

---

## 第一部分：问题描述——推理尾延迟的可观测现象

### 1.1 业务背景：RL 训练采样的数据流

本项目是一个 MOBA 游戏的强化学习训练系统，采用 Actor-Learner 解耦架构：

```
Actor（采样节点, CPU）       ReplayBuffer           Learner（训练节点, GPU）
  ├─ 环境仿真                    ├─ 接收样本             ├─ 从 RB 采样 batch
  ├─ SL 推理（行为策略）          ├─ 存储                 ├─ forward + backward
  ├─ RL 采样（策略梯度）          └─ 供 Learner 采样       └─ optimize → 更新权重
  └─ 产出 (state, action, reward) 元组
```

**部署拓扑**：物理服务器 → VMware 虚拟化 → VM（88 vCPU）→ K8s → Ray Pod

**每个采样节点上的组件**：
- **Sampler Actor**：运行环境仿真，每个 Actor 模拟一局游戏中的多个英雄
- **Infer Actor**：独立的 Ray Actor，封装OpenVINO，通过共享内存队列（`SharedInferenceQueue`）接收推理请求
- **SharedInferenceQueue**：256 槽位的状态机队列，用 `fcntl.flock` 互斥保护

### 1.2 Task-A 任务的关键指标

Task-A 是一次在 VMware 虚拟化双节点上运行的 SHM 架构训练任务。以下数据直接从其 TensorBoard 日志解析获得（共 10000 步，步范围 [3, 20210]）：

| 指标 | 均值 | 含义 |
|------|------|------|
| `samples_per_sec` | **748.5** | 每秒产出训练样本数 |
| `updates_per_sec` | **0.3655** | 每秒梯度更新次数 |
| `learn_total_ms` | **2774.8** | 单次训练步总耗时 |
| `batch_recv_ms` | **2615.9** | 等待 ReplayBuffer 填满一个 batch 的耗时 |
| `forward_ms` | 59.2 | GPU 前向 |
| `backward_ms` | 63.4 | GPU 反向 |
| `optimize_ms` | 31.8 | 优化器步 |
| `rb_insert_rate` | **735.5** | ReplayBuffer 每秒接收样本数 |
| `rb_capacity_pct` | **99.97%** | 缓冲区接近满载 |

**核心矛盾**：`batch_recv_ms / learn_total_ms = 2615.9 / 2774.8 = 94.3%`。Learner 有 **94.3% 的时间在空等样本**，GPU 实际计算仅占 5.6%。采样产能（735 samples/s）远不足以饱和 GPU。

### 1.3 推理 Actor 的尾延迟现象

采样侧推理的微观指标（Task-A TensorBoard `model_dispatcher` 下 `sample_infos/sl_remote_*` 标量）：

| 指标 | 均值 | 均值的最大值 | 尾部放大倍数 |
|------|------|------------|------------|
| `sl_remote_infer_exec_ms` | 16.6 | 160.5 | **9.7x** |
| `sl_remote_queue_wait_ms` | 8.9 | 336.8 | 37.9x |
| `sl_remote_rpc_ms` | 95.4 | 1101.2 | 11.5x |
| `sl_remote_client_overhead_ms` | 69.9 | 1074.7 | 15.4x |
| `sl_remote_batch_total_ms` | 120.4 | 1126.1 | 9.4x |
| `sl_remote_batch_size` | 4.29 | 16.0 | — |
| `sl_remote_infer_exec_ratio_avg` | 0.098 | — | 推理仅占 9.8% |

**推理执行本身均速仅 16.6ms**，但尾延迟（窗口内最大值的均值）飙升至 160.5ms——近 10 倍放大。批处理往返尾延迟更是 1126ms，而推理执行占比仅 9.8%。

**尾延迟的核心度量——`deschedule_ms`**：

```python
# 计算线程被换出CPU的空窗时间
infer_time_ms = float(total_elapsed_s) * 1000.0      # time.perf_counter() 墙上时间
cpu_ms = float(cpu_elapsed_s) * 1000.0               # time.process_time() 进程CPU总和
deschedule_ms = max(0.0, infer_time_ms - cpu_ms)     # 线程被换出CPU的空窗
```

**跨环境 `p999_deschedule_ms` 对比**：

| 环境 | `p999_deschedule_ms` | 量级 | 备注 |
|------|---------------------|------|------|
| VMware（`rt_runtime_us=950000`，SCHED_FIFO 可用） | ≈ 0.02ms | μs | 理想配置，RT 预算充裕 + 实时调度 |
| VMware（`rt_runtime_us=500000`） | 400-470ms | 4 个数量级放大 | RT 预算不足，co-scheduling 互锁完全暴露 |
| VMware（`rt_runtime_us=800000`） | 55-147ms | 3 个数量级放大 | RT 预算部分缓解 |

> 数据来源：三组数据均来自 VMware 环境下的生产日志 `slow_infer` 事件统计与 TensorBoard 周期性 `p999_deschedule_ms` 标量。0.02ms 并非裸金属实测值，而是 VMware 在 SCHED_FIFO 可用 + RT 预算充裕时的最优下限。

### 1.4 尾延迟的业务后果

- `step_elapsed` 抖动 → 采样吞吐不稳 → 训练效率波动
- `p999` 长尾拖累整体吞吐（受最慢推理请求制约）
- 排队级联：一个慢请求导致后续所有请求排队，`queue_wait` 尾延迟（336.8ms）远超推理执行尾延迟（160.5ms）

### 1.5 诊断问题陈述

- 为什么同样的代码、同样的负载，跨环境尾延迟差 4 个数量级？
- `deschedule` 的本质是"推理线程被换出后未能及时重新调度"
- 是谁换出了推理线程？又是谁阻止了它回来？
- 这两个问题的答案分布在不同的抽象层

---

## 第二部分：全栈根因分析的分层框架

### 2.1 四层抽象模型

```
┌─ 应用层: Ray 框架 + SHM 通信架构
├─ 系统层: Linux 内核 (NUMA / CPU 亲和性 / 调度器)
├─ 微架构层: CPU Cache / MESI / 内存访问延迟
└─ 虚拟化层: VMware (vCPU 调度 / 拓扑暴露 / 内存虚拟化)
```

### 2.2 分层原则：每层只在该层的抽象边界内有效

| 层 | 承诺/假设 | 失效条件 |
|----|---------|---------|
| 应用层 | Ray 屏蔽基础设施，SHM 是高效 IPC | NUMA 局部性不可控 |
| 系统层 | NUMA 拓扑正确暴露，内核可控制物理页落点 | VM 内 NUMA=1 |
| 微架构层 | 数据局部性可控，cache 一致性开销可忽略 | 拓扑欺骗导致 cache 跨 Socket |
| 虚拟化层 | vCPU 调度透明，拓扑传递忠实 | co-scheduling 互锁 |

### 2.3 核心论点

**尾延迟是主动穿透抽象的紧密依赖与抽象泄漏的交叉放大。** 单看任一层都找不到完整答案，必须穿透四层才能定位真正的"换出者"与"阻止者"。

---

## 第三部分：应用层诊断——SHM 通信架构与 Ray 抽象

### 3.1 Infer Actor 架构设计

Infer Actor 经历了三个版本的演进，核心驱动力是 **消除推理线程与 Ray gRPC 线程的 CPU 竞争**：

| 版本 | 类名 | 核心机制 | 线程/进程模型 |
|------|------|---------|-------------|
| 基础版 | `SLSharedMemoryInferenceActor` | SHM 队列 + daemon thread | 推理线程与 gRPC 线程同进程 |
| 亲和性版 | `SLSharedMemoryInferenceActorAffinity` | + CPU 绑核 + SCHED_FIFO | 三级绑核，但仍同进程 |
| **隔离版** | `SLSharedMemoryInferenceActorIsolated` | **推理子进程隔离** | **gRPC 与推理分属不同进程** |

#### 3.1.1 为什么需要进程隔离

前两个版本（基础版、亲和性版）的推理工作线程与 Ray gRPC 线程运行在 **同一进程** 内。历史诊断日志揭示了致命的 CPU 竞争模式：

```
推理线程实际 CPU：40ms（batch=12）
进程总 CPU（含 gRPC 线程）：295ms     ← time.process_time() 计入所有线程
墙上时间：300ms                        ← CFS 在 4 线程间分时
```

Ray Actor 进程内有 3 个 gRPC 线程（由 Ray 框架在业务代码之前创建），与推理工作线程共享同一 CPU。CFS 公平调度导致推理线程的 40ms CPU 被拉长到 ~300ms wall time。

亲和性版尝试通过三级绑核 + SCHED_FIFO 解决，但：
1. SCHED_FIFO 需要 `CAP_SYS_NICE`，K8s 容器通常缺失该权限
2. 即使 SCHED_FIFO 可用，gRPC 线程仍同进程，推理期间被饿死可能导致 Ray 通信超时
3. `nice(-20)` 降级仍受 CFS 公平调度约束，每时间片仍会切换

**隔离版的根本思路**：既然同进程内的线程竞争无法彻底消除，那就把推理放到 **独立子进程** 中——Ray Actor 进程只做 gRPC 通信，子进程只做推理，两个进程各占一个 CPU 核心，**物理隔离，零竞争**。

#### 3.1.2 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│        Ray Actor 进程（SLSharedMemoryInferenceActorIsolated）  │
│                                                                │
│  ┌─────────────┐                                                │
│  │  Ray gRPC   │  只负责通信，不做推理                            │
│  │  线程 (3个)  │  CPU 亲和性：释放到所有核（不绑核）              │
│  └──────┬──────┘                                                │
│         │                                                       │
│    创建 SHM Queue + spawn 子进程                                 │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────────────────────────────┐                      │
│  │     SharedInferenceQueue (SHM)        │                      │
│  │  256 槽位 + fcntl.flock 互斥           │                      │
│  └──────────┬───────────────┬───────────┘                      │
│             │               │                                   │
└─────────────┼───────────────┼───────────────────────────────────┘
              │               │
     客户端 submit_request    子进程 claim_ready_slots
              │               │
              ▼               ▼
┌──────────────────────────────────────────────────────────────┐
│        推理子进程（_inference_subprocess_main）                  │
│                                                                │
│  ┌──────────────────────────────────────────┐                  │
│  │  1. apply_thread_cpu_affinity(cpu_id)     │  绑定到指定核     │
│  │  2. os.nice(-20) + try_set_sched_fifo()   │  提升调度优先级   │
│  │  3. attach_shared_inference_queue()       │  连接 SHM 队列    │
│  │  4. OpvnLocal(model_dir)                  │  加载OpenVINO     │
│  │  5. while True: 推理循环                   │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                │
│  CPU 亲和性：独占绑定到指定核（与 Actor 进程完全隔离）            │
└──────────────────────────────────────────────────────────────┘
```

**关键设计**：
- Ray Actor 进程 **不做任何推理**，只负责 SHM 队列创建、子进程管理和 gRPC 通信
- 推理子进程 **不做任何通信**，只负责模型加载和推理执行
- 两个进程通过 **SHM 队列** 通信，数据零拷贝，无序列化开销
- 两个进程 **各自绑核**，物理隔离，CFS 不会在它们之间切换

#### 3.1.3 Actor 进程侧：初始化与子进程管理

Actor 进程的 `__init__` 完成三件事：

**步骤 1：CPU 分配**

```python
# 通过集中式租约分配器获取独占 CPU
owner_id = f"infer:{hero_id}:{actor_id}"
allocator = get_or_create_node_cpu_affinity_allocator(node_id=node_id, ...)
cpu_id = ray.get(allocator.acquire.remote(owner_id=owner_id, ...))

# 进程级绑核（让子进程继承受限的 cpuset）
apply_process_cpu_affinity(cpu_id)
```

**步骤 2：创建 SHM 队列**

```python
queue_name = f"sl_shm_isolated_h{hero_id}_{uuid.uuid4().hex[:8]}"
self._queue = create_shared_inference_queue(
    queue_name=queue_name,
    slot_count=256,
    request_bytes=16384,
    response_bytes=32768,
)
self._endpoint = {"queue_bundle": dict(self._queue.bundle)}
```

**步骤 3：spawn 推理子进程**

```python
ctx = multiprocessing.get_context("spawn")
self._worker_proc = ctx.Process(
    target=_inference_subprocess_main,
    kwargs={
        "queue_bundle": dict(self._queue.bundle),  # 传递 SHM 队列描述符
        "hero_id": hero_id,
        "model_dir": model_dir,
        "cpu_id": cpu_id,                           # 传递绑定的 CPU ID
        "inference_num_threads": 1,
        "max_batch_size": max_batch_size,
        ...
    },
    daemon=True,
)
self._worker_proc.start()

# 释放主线程到所有核（gRPC 线程不受约束）
reset_thread_cpu_affinity()
```

**与亲和性版的关键差异**：
- 亲和性版：`apply_process_cpu_affinity` 绑核后，推理线程和 gRPC 线程 **同进程**，靠 `reset_thread_cpu_affinity` 释放主线程——但OpenVINO内部线程仍可能与 gRPC 线程竞争
- 隔离版：子进程 **独立进程**，继承绑核的 cpuset，gRPC 线程在 Actor 进程中完全不受约束——**物理隔离，无竞争可能**

隔离版使用 `multiprocessing.get_context("spawn")`——spawn 方式创建全新进程（不 fork），确保子进程不继承 Actor 的线程状态和 GIL。

#### 3.1.4 子进程侧：推理执行引擎

子进程入口函数 `_inference_subprocess_main` 完成 6 个阶段：

**阶段 0-2：初始化**

```python
# 1. 绑定到指定 CPU 核心（子进程独占）
apply_thread_cpu_affinity(cpu_id)

# 2. 提升 CFS 优先级（SCHED_FIFO 不可用时的降级）
os.nice(-20)

# 3. 尝试 SCHED_FIFO（按需切换：推理时 FIFO，空闲时 OTHER）
_sched_fifo_enabled = try_set_sched_fifo()
if _sched_fifo_enabled:
    try_set_sched_other()  # 空闲时切回普通调度
```

**阶段 3-4：连接 SHM + 加载模型**

```python
# 3. attach 到 Actor 创建的 SHM 队列
queue = attach_shared_inference_queue(queue_bundle)

# 4. 加载OpenVINO模型（子进程独立加载，不与 Actor 共享）
engine = OpvnLocal(model_dir, inference_num_threads=1, ...)
input_cache: dict[str, SharedNdarraySlot] = {}
output_cache: dict[str, SharedNdarraySlot] = {}
```

**阶段 5-6：推理循环**

```python
while True:
    # 批量领取就绪请求（支持最小批量等待）
    claimed = queue.claim_ready_slots(
        max_slots=max_batch_size,
        max_total_batch_size=16,
        min_total_batch_size=8,   # 最小 8 个样本
    )
    if not claimed:
        time.sleep(0.0005)       # 0.5ms 空转
        continue

    # 推理前切换 SCHED_FIFO
    if _sched_fifo_enabled:
        try_set_sched_fifo()

    # 5 阶段推理流水线
    for pr in claimed:
        input_slot = _get_cached_slot(input_cache, pr.request["input_bundle"])
        request_arrays.append(input_slot.arrays)          # ① attach_input（零拷贝）

    merged = stack_input_dicts(request_arrays)              # ② merge_input
    outputs, timing = engine.get_infer_results_with_timing(merged)  # ③ OpenVINO执行

    for pr, batch_size in zip(claimed, batch_sizes):
        req_outputs = _slice_outputs(outputs, start, end)   # ④ slice_output
        _write_cached_output(req_outputs, output_bundle, output_cache)  # ⑤ bundle_write
        queue.complete_slot(pr.slot_idx, response, ok=True)

    # 推理后切回 SCHED_OTHER
    if _sched_fifo_enabled:
        try_set_sched_other()
```

**慢推理诊断**：当 `engine_cpu_s > 0.100`（进程 CPU > 100ms）或 `total_elapsed_s > 0.200`（总耗时 > 200ms）时触发 `slow_infer` 日志：

```python
if e_cpu_s > 0.100 or total_elapsed_s > 0.200:
    debugger.warning(
        "slow_infer hero=%s cpu=%d slots=%d total_batch=%d "
        "engine_cpu_ms=%.1f engine_thread_cpu_ms=%.1f engine_wait_ms=%.1f "
        "wall_ms=%.1f deschedule_ms=%.1f "
        "sched_fifo=%s affinity=process_isolated threads=%d",
        ...
    )
```

注意日志中的 `affinity=process_isolated` 标识——隔离版的 `threads` 计数远小于亲和性版（子进程内只有推理线程，无 gRPC 线程），这是验证隔离效果的关键指标。

#### 3.1.5 共享内存队列状态机

`SharedInferenceQueue` 基于 POSIX `shared_memory.SharedMemory`（底层 `shm_open` + `mmap`）。队列由 256 个槽位组成，每个槽位经历以下状态机：

```
FREE(0) → WRITING(1) → READY(2) → PROCESSING(3) → DONE(4)/ERROR(5) → FREE(0)
  ↑                    ↑                        ↑
  客户端获取            客户端提交               子进程领取
```

**槽位内存布局**：

```python
# 256 个槽位的状态数组，连续排列在共享内存起始区域
self._states = np.ndarray((slot_count,), dtype=np.int32, buffer=shm.buf, offset=0)
self._request_lens = np.ndarray((slot_count,), dtype=np.int32, ...)
self._response_lens = np.ndarray((slot_count,), dtype=np.int32, ...)
self._request_region = memoryview(shm.buf)[...]   # 16KB/槽
self._response_region = memoryview(shm.buf)[...]   # 32KB/槽
```

**互斥机制**：`fcntl.flock` 文件锁保护槽位分配，而非自旋锁。flock 在竞争不激烈时开销极低（微秒级），且不会因忙等浪费 CPU。

**提交请求**（客户端侧）：

```python
def submit_request(self, request, timeout_s):
    slot_idx = self.acquire_free_slot(timeout_s=timeout_s)  # FREE→WRITING (flock 保护)
    payload_len = self._write_payload(self._request_slice(slot_idx), ...)
    self._request_lens[slot_idx] = payload_len
    self._states[slot_idx] = _QUEUE_STATE_READY              # WRITING→READY
    return slot_idx
```

**批量领取**（子进程侧）：支持最小批量预扫描（Phase 1）和原子 READY→PROCESSING 领取（Phase 2），避免在小批量时频繁触发推理。

#### 3.1.6 客户端异步架构

客户端 `InferenceShmClientAsync` 运行在 Sampler Actor 进程中，采用 **异步两阶段** 设计：

**阶段 1：`infer_batch_async_start`**——提交阶段，非阻塞

```python
actor_name, endpoint = self._next_target()         # 轮询选择 Infer Actor
input_slot = self._acquire_batch_input_slot(inputs_list)   # 获取预分配输入 slot
output_slot = self._acquire_output_slot(len(inputs_list))  # 获取预分配输出 slot
input_slot.write_inputs_list(inputs_list)           # 零拷贝写入 SHM
slot_idx = queue.submit_request(                    # 提交到 SHM 队列
    {"input_bundle": input_slot.bundle,
     "output_bundle": output_slot.bundle,           # 预分配输出 bundle
     "enqueue_time_s": enqueue_time_s, ...},
    timeout_s=self.timeout_s)
return {"slot_idx": slot_idx, "queue": queue, ...}  # 返回 pending 句柄
```

**阶段 2：`infer_batch_async_finish`**——等待+读取阶段

```python
response, _ = queue.await_response(slot_idx, timeout_s=timeout_s)  # 轮询 DONE
stacked_outputs = self._read_or_adopt_output_slot(  # 零拷贝读取
    batch_size=batch_size, data=data, reusable_slot=output_slot)
outputs = split_output_dict(stacked_outputs, batch_size)  # 按 batch 切分
# 记录完整 timing: rpc_elapsed_s, queue_wait_s, infer_exec_s, client_overhead_s 等
```

**零拷贝通信的关键**：

1. **输入零拷贝**：`input_slot.write_inputs_list` 直接写入 SHM 物理页，子进程通过 `input_slot.arrays` 引用同一物理页
2. **输出零拷贝**：`_read_or_adopt_output_slot` 直接将子进程写入的 SHM 区域包装为 numpy 数组返回，不经过序列化
3. **预分配 slot 复用**：input_slot 和 output_slot 通过缓存池复用，避免每次推理都创建/销毁 SHM 段

#### 3.1.7 三版本对比与隔离版的优势

| 维度 | 基础版 | 亲和性版 | **隔离版** |
|------|--------|---------|-----------|
| 推理执行者 | daemon thread | daemon thread | **子进程** |
| gRPC 线程竞争 | 严重（同进程） | 缓解（三级绑核 + FIFO） | **消除（不同进程）** |
| OpenVINO内部线程 | 可能抢占 gRPC | 进程级绑核约束 | **完全隔离** |
| SCHED_FIFO 依赖 | 无 | 强依赖（缺权限则降级） | 弱依赖（子进程独立） |
| `engine_cpu_ms` vs `engine_thread_cpu_ms` | 6-20x 差距 | 仍有差距 | **≈1:1**（无竞争） |
| 进程间通信 | 无（同进程） | 无（同进程） | SHM 队列（零拷贝） |
| 资源开销 | 1 进程 / Actor | 1 进程 / Actor | **2 进程 / Actor** |

**隔离版的核心优势**：

在隔离版中，子进程的 `engine_cpu_ms`（进程 CPU）与 `engine_thread_cpu_s`（线程 CPU）应该 **≈1:1**——因为子进程内只有推理线程，没有 gRPC 线程竞争。这是验证进程隔离效果的关键指标。

**代价**：每 Actor 多 1 个进程（多 1 个进程的内存开销），但换来了 **彻底的 CPU 隔离**，消除了模式 A（CPU 竞争型）的 80%+ 慢推理事件。

### 3.2 SHM 通信架构剖析

`SharedInferenceQueue` 核心定义：

```python
class SharedInferenceQueue:
    def __init__(self, bundle, shm, owner=False):
        self.slot_count = int(bundle["slot_count"])       # 默认 256 个槽位
        self.request_bytes = int(bundle["request_bytes"]) # 默认 16384 字节/槽
        self.response_bytes = int(bundle["response_bytes"]) # 默认 32768 字节/槽

        # 槽位状态数组：256 个 int32，连续排列在共享内存起始区域
        self._states = np.ndarray((self.slot_count,), dtype=np.int32,
                                   buffer=self.shm.buf, offset=0)
        self._request_lens = np.ndarray(...)   # 紧随其后
        self._response_lens = np.ndarray(...)  # 紧随其后
        self._request_region = memoryview(...)  # 请求载荷区
        self._response_region = memoryview(...) # 响应载荷区
```

**槽位状态机**：`FREE(0) → WRITING(1) → READY(2) → PROCESSING(3) → DONE(4)/ERROR(5) → FREE(0)`

客户端通过 `submit_request` 将请求写入空闲槽位，Infer Actor 通过 `claim_ready_slots` 批量领取，推理完成后 `complete_slot` 写入响应，客户端通过 `await_response` 轮询状态。

**互斥机制**：使用 `fcntl.flock` 文件锁保护槽位分配，而非自旋锁。这是有意的权衡——flock 在竞争不激烈时开销极低（微秒级），且不会因忙等浪费 CPU。

`SharedNdarraySlot` 实现 input/output 零拷贝阵列传输：

```python
def create_shared_ndarray_slot(arrays):
    bundle, shm = create_shared_ndarray_bundle(arrays)
    mapped_arrays, mapped_shm = open_shared_ndarray_bundle(bundle, copy_arrays=False)
    # copy_arrays=False: 不拷贝数据，直接映射 shm.buf 为 numpy 数组
    return SharedNdarraySlot(bundle=bundle, shm=mapped_shm, arrays=mapped_arrays)

def attach_shared_ndarray_slot(bundle):
    arrays, shm = open_shared_ndarray_bundle(bundle, copy_arrays=False)
    # 服务端通过 bundle 描述符 attach 到同一块共享内存
    return SharedNdarraySlot(bundle=bundle, shm=shm, arrays=arrays)
```

### 3.3 SHM vs Socket 通信的数据通路对比

Socket 版 Actor 使用 `PickledConnection` 通过 TCP loopback 通信：

| 维度 | SHM 通信 | Socket 通信 |
|------|---------|------------|
| 数据拷贝 | **零拷贝**（共享内存直接映射，`copy_arrays=False`） | 至少 2 次（send buffer → kernel skb → recv buffer） |
| 序列化 | 无（numpy 数组直接共享物理页） | pickle 序列化/反序列化 |
| 互斥 | `fcntl.flock` 文件锁 | TCP 连接天然串行 |
| NUMA 耦合 | **强耦合**（数据页物理位置决定访问延迟） | **弱耦合**（内核网络栈缓冲，NUMA 影响小） |
| 延迟 | μs 级（本地 NUMA）/ μs+ 级（远端 NUMA） | μs~ms 级（取决于 TCP 栈和负载） |
| 吞吐 | 受限于内存带宽（153.6 GB/s） | 受限于 TCP 协议栈（~10-40 Gbps） |

**SHM 数据通路**：客户端 CPU → 写入 SHM 物理页 P → Infer Actor CPU → 读同一物理页 P → L3 cache → OpenVINO计算。物理页 P 只能存在于一个 NUMA 节点。

**Socket 数据通路**：客户端 CPU → pickle 序列化 → 写入 TCP send buffer（kernel 在客户端本地 NUMA 分配）→ loopback → kernel skb → recv buffer（kernel 在服务端本地 NUMA 分配）→ 反序列化 → 新建 numpy 数组（服务端本地 NUMA）。

### 3.4 SHM 通信对底层物理拓扑的隐含依赖

SHM 性能本质是 **物理页局部性**（落点决定访问延迟）：
- 同 NUMA node 访问：~80-120ns/次
- 跨 node（经 xGMI）：~200-250ns/次

> **文献背书**：Drepper, U. *What Every Programmer Should Know About Memory*, 2007, §3.4 — 本地 DRAM 访问延迟 ~80ns，跨 Socket ~200ns。CSAPP §9.8 — NUMA 架构下内存访问延迟非一致性。

**关键**：这个依赖在应用层不可见，但决定了性能上限。`shm.buf[:] = b"\x00" * len(shm.buf)` 由创建队列的单一线程执行，Linux 的 first-touch policy 会将这块共享内存的所有物理页分配到 **该线程当前所在的 NUMA 节点**。

### 3.5 Ray 框架的抽象边界与失效点

Ray 承诺：`num_cpus` 约束资源，屏蔽基础设施差异。但存在三个失效点：

**失效点 1**：`num_cpus` 不控制"哪个核" → 推理线程核间漂移

Ray 的 `num_cpus=1` 只限制调度配额，不指定具体 CPU。推理线程可能在任意核心上运行，导致 L3 缓存反复失效。

**失效点 2**：Ray 不感知 NUMA → SHM 物理页落点失控

Ray 调度器不知道 NUMA 拓扑，无法保证 Sampler Actor 和 Infer Actor 落在同一 NUMA 节点。SHM 物理页可能被 first-touch 到远端节点。

**失效点 3**：Ray gRPC 线程与推理线程争核

Ray Actor 进程内有 3 个 gRPC 线程（由框架启动，在业务代码之前创建），与推理工作线程共享同一 CPU。CFS 公平调度导致推理线程的 40ms CPU 被拉长到 ~300ms wall time。

**证据**：项目被迫实现 `cpu_affinity_runtime.py` 穿透抽象：

```python
# 业务层手动绑核，穿透 Ray 的 CPU 抽象
def apply_process_cpu_affinity(cpu_id: int) -> list[int]:
    normalized_cpu_id = int(cpu_id)
    os.sched_setaffinity(0, {normalized_cpu_id})  # ← 业务层手动绑核
    actual = sorted(int(item) for item in os.sched_getaffinity(0))
    if actual != [normalized_cpu_id]:
        raise CpuAffinityError(...)
    return actual
```

历史诊断日志证实：`engine_cpu_ms`（进程总 CPU，含 gRPC 线程）>> `engine_thread_cpu_ms`（推理线程 CPU），比值 6~20 倍。batch=12 时推理线程仅消耗 40ms CPU，但 gRPC 线程消耗 256ms，CFS 将两者拉长到 ~300ms wall time。

### 3.6 应用层结论

- SHM 通信的性能寄托在"物理页局部性"上
- Ray 抽象不提供 NUMA 局部性保证
- 业务层被迫穿透抽象（`cpu_affinity_runtime.py`），但穿透手段（CPU 亲和性）是否充分？
- → 需进入系统层诊断

---

## 第四部分：系统层诊断——NUMA 局部性与 CPU 亲和性

### 4.1 概念地基：四名词的三层抽象模型

| 概念 | 本质 | 层次 | 本项目中的体现 |
|------|------|------|--------------|
| **CPU** | 物理计算核心，执行指令的最小独立单元 | 最底层（硬件） | EPYC 9634每颗 84 核，`sched_setaffinity` 绑定的对象 |
| **Socket** | CPU 插槽，主板上的 CPU 安装位 | 硬件封装层 | 双路服务器有 2 个 Socket，每个承载 1 颗 EPYC |
| **NUMA** | 非一致性内存访问，内存架构模型 | 内存架构层 | 每颗 CPU 的本地 DDR5 构成 1 个 NUMA 节点，双路 = 2 NUMA |
| **共享内存（SHM）** | 进程间通信机制，多进程映射同一物理页 | 软件通信层 | `SharedInferenceQueue` 通过 `shared_memory.SharedMemory` 创建 |

**因果链**：物理层（CPU Core / Socket / IMC / CCD-IF-xGMI）→ 系统层（NUMA Node）→ 软件层（Shared Memory）。单向依赖：下层决定上层能力。

> **文献背书**：CSAPP §6.1（存储技术层次）、§9.9（NUMA）；AMD EPYC 9004 Server Optimization Guide §2（系统架构）；Bovet & Cesati §3（内存管理）；Linux kernel docs: `numa_memory_policy.rst`。

### 4.2 已验证硬件事实（基于 lscpu 实测）

#### 4.2.1 物理服务器配置

训练集群使用 **AMD EPYC 9634**（Zen 4 架构）双路服务器：

| 属性 | 物理服务器 |
|------|-----------|
| CPU 型号 | AMD EPYC 9634 (Zen 4 架构) |
| 插槽数 (Socket) | **2** |
| 每插槽物理核 | 84（未开启超线程） |
| 总物理核 | 168 |
| NUMA 节点数 | **2**（每路 1 个，NPS1 模式） |
| CCD 数 | **24**（每路 12 个 CCD） |
| L3 缓存 | 384MB / 路（每 CCD 32MB，CCD 内 7 核共享） |
| 内存通道 | 每路 **4 通道** DDR5-4800 |
| 内存带宽 | 4 × 4800MT/s × 8B = **153.6 GB/s / 路** |

**AMD Zen 4 chiplet 架构详解**：

每颗 EPYC 由 1 个 **IOD（I/O Die）** 和 12 个 **CCD（Core Complex Die）** 组成。每个 CCD 含 8 个 Zen 4 核心，共享 32MB L3 缓存。IOD 集成内存控制器（IMC）和 Infinity Fabric 互连。

```
物理服务器（1 台）
├── Socket 0（CPU 插槽 0，1 颗 EPYC）
│   ├── CCD 0  ── 核 0-6   ── 32MB L3 (CCD 内共享)
│   ├── CCD 1  ── 核 7-13  ── 32MB L3
│   ├── ... (共 12 CCD，部分核禁用，每 CCD 实际 7 核)
│   ├── IOD（I/O Die）── Infinity Fabric 连接所有 CCD
│   └── DDR5 控制器 ── 4 通道 DDR5-4800 ── 本地内存 128GB
│       └── = NUMA Node 0 (CPU 0-83)
│
├── Socket 1（CPU 插槽 1，1 颗 EPYC）
│   ├── CCD 12 ── 核 84-90
│   ├── ... (共 12 CCD)
│   └── DDR5 控制器 ── 4 通道 DDR5-4800 ── 本地内存 128GB
│       └── = NUMA Node 1 (CPU 84-167)
│
└── xGMI 互连（Socket 0 ⇄ Socket 1，主板高速链路）
    └── 带宽 ~384 GB/s（双向），延迟 ~200-250ns
```

**内存带宽说明**：EPYC 原生支持 12 通道 DDR5，满配带宽约 460.8 GB/s/路。本服务器仅插 4 条 DDR5-4800（32GB/条），实际带宽 153.6 GB/s/路，为满配的 33%。这对推理业务影响有限（推理为计算密集型），但对采样数据传输有影响。

**关键延迟数据**（从 CPU 核心视角）：

| 访问目标 | 路径 | 典型延迟 |
|---------|------|---------|
| L1 cache（核内，32KB） | 私有 | ~1ns（~4 cycles @ 4GHz） |
| L2 cache（核内，1MB） | 私有 | ~4ns（~16 cycles） |
| L3 cache（CCD 内，32MB） | CCD 内 7 核共享 | ~12-15ns |
| **本地 NUMA 内存**（同 Socket DDR5） | CPU → IOD → IMC → DDR5 | **~80-120ns** |
| **远端 NUMA 内存**（跨 Socket xGMI） | CPU → IOD → xGMI → 对端 IOD → 对端 DDR5 | **~200-250ns** |

> **文献背书**：AMD *EPYC 9004 Architecture Whitepaper* — Infinity Fabric（片内）延迟 ~10ns，xGMI（跨 Socket）延迟 ~200ns。AMD Publication 56693 Chapter 7 — Cache Coherence and NUMA。AnandTech *AMD EPYC 9654 Review* AIDA64 测试：本地 DDR5 ~120ns，跨 Socket ~230ns。

#### 4.2.2 VMware 虚拟化节点配置

物理服务器通过 VMware 虚拟化为两个 K8s 计算节点：

| 属性 | 虚拟化节点 A | 虚拟化节点 B |
|------|-------------|-------------|
| vCPU 数 | **88** | **88** |
| Socket 数（虚拟拓扑） | **88** | **88** |
| NUMA 节点数 | **1** | **1** |

VM 内部 `lscpu` 关键字段：

```
# VM 内部（虚拟节点 B）
Architecture:        x86_64
CPU(s):              88
Thread(s) per core:  1
Core(s) per socket:  1
Socket(s):           88              # ← 每个 vCPU 都是独立 Socket！
NUMA node(s):        1               # ← NUMA 被抹平
```

对比物理服务器：

```
# 物理服务器
CPU(s):              168
Core(s) per socket:  84
Socket(s):           2               # ← 真实双路
NUMA node(s):        2               # ← 真实 NUMA
```

#### 4.2.3 虚拟化拓扑欺骗的三重物理冲突

将物理服务器的 168 核切分为 88+88 两个虚拟节点，在底层引爆了三个致命冲突：

**冲突 1：VMware 协同调度（Co-Scheduling）互锁**

**硬件事实**：单颗物理 CPU 仅有 84 个核心。虚拟节点 B 配置为 88 核，恰好占满一颗 CPU——但虚拟节点 A 的 88 核也需要物理核。

**超卖事实**：VMware 对大规格虚拟机采用 **严格协同调度（Relaxed Co-Scheduling）**：vCPU 必须同时调度才能推进。当节点 B 占满 CPU 1 的 84 核时，节点 A 的 88 个 vCPU 必须在 CPU 0 上运行；但如果节点 A 也有 vCPU 被映射到 CPU 1 的核上（VMware vCPU 到 pCPU 的映射不固定），就会产生 **跨插槽凑核**。

**后果**：VMware 调度器解决这种互锁的轮转重试周期在 **50ms ~ 470ms** 级别。此时，业务层即便启用了 SCHED_FIFO（最高实时优先级），其指令也会直接卡在半空中——因为 vCPU 根本没有在 pCPU 上运行。

> **文献背书**：VMware vSphere Documentation: "CPU Scheduling in VMware ESXi" — co-scheduling overhead increases nonlinearly when vCPU-to-pCPU ratio exceeds 1:1。

**冲突 2：错误的虚拟拓扑欺骗 Linux 内核**

虚拟机内部将每个 vCPU 上报为独立的 "Socket"（单核插槽），NUMA 节点数为 1。Linux 内核和 Ray 调度器被 "88 Sockets" 拓扑欺骗，误认为每次线程切换都是一次跨越物理主板的重大迁移。内核被迫放弃了轻量级的局部多核优化（如 per-socket 缓存行、本地中断亲和），转而频繁启动最沉重的全局内核同步锁（kernel barrier）与内存屏障（memory barrier）。

**冲突 3：跨插槽缓存污染与总线锁死**

**NUMA 边界抹除**：VM 内 NUMA=1，`set_mempolicy`/`mbind` 等 NUMA 内存策略系统调用 **完全失效**——Linux 认为所有内存在同一个 NUMA 节点上。

**缓存污染链**：
1. OpenVINO计算时吃满 L3 缓存（384MB/路）
2. VMware vCPU 在底层 pCPU 上漂移（因为 NUMA=1，Linux 无法控制）
3. 节点 A 刚加载的缓存上下文被节点 B 的 vCPU 瞬间驱逐（evict）
4. CPU 核心为跨 xGMI 总线抓取残余数据，触发硬件一致性协议
5. 高频触发 **系统总线锁死（Bus Lock）**，CPU 流水线陷入数毫秒空转

> **文献背书**：AMD Zen 4 架构白皮书 — 跨 CCD 的 L3 缓存访问延迟约 130ns，跨 Socket（xGMI）约 200-250ns。AMD Publication 56693 Chapter 7 — MESI 协议 invalidate 请求导致总线争用。Brendan Gregg, *Systems Performance* 2nd Ed. (2020), §7.4 — "In virtualized environments, the guest OS may see a different NUMA topology than the physical hardware, which can cause unexpected memory placement."

### 4.3 First-touch 策略的真相

**机制**：Linux 采用延迟分配（demand paging），物理页在首次访问时通过缺页异常触发分配。默认策略 `MPOL_DEFAULT`：从触发缺页的 CPU 所在 node 分配。

```python
# owner 进程单线程清零，触发 first-touch
shm = shared_memory.SharedMemory(
    create=True,
    size=_queue_buffer_nbytes(slot_count, request_bytes, response_bytes),
)
shm.buf[:] = b"\x00" * len(shm.buf)  # ← 单线程零填充，触发 first-touch
```

这行代码执行时所在线程的 NUMA 位置，**永久决定**了后续所有进程访问该 SHM 的延迟。如果绑核正确（创建线程在 Node 0，访问线程也在 Node 0），性能最优；如果绑核错误或 NUMA 失效，性能退化且无法通过后续操作修正（物理页一旦分配不会迁移，除非显式调用 `move_pages(2)`）。

> **文献背书**：Drepper §6 — first-touch policy 详解。Linux kernel docs: `numa_memory_policy.rst` — "The default policy is local allocation."

### 4.4 CPU 亲和性 ≠ NUMA 内存亲和性（核心机制澄清）

这是两个 **独立的** 操作系统机制，常被混淆：

| 机制 | 系统调用 | 控制对象 | 本项目是否使用 |
|------|---------|---------|--------------|
| CPU 亲和性 | `sched_setaffinity(2)` | 线程可以在哪些 CPU 上运行 | **是** |
| NUMA 内存策略 | `set_mempolicy(2)` / `mbind(2)` | 内存页分配到哪个 NUMA 节点 | **否** |

```python
# 仅实现 CPU 亲和性，未控制内存分配域
def apply_process_cpu_affinity(cpu_id: int) -> list[int]:
    os.sched_setaffinity(0, {normalized_cpu_id})  # ← 只控制 CPU 调度域
    ...
```

`sched_setaffinity` 仅约束线程的 **CPU 调度域**，不约束 **内存分配域**。二者独立，必须配合才能保证 SHM 局部性。**项目现状：只实现 CPU 亲和性，缺内存亲和性。**

> **文献背书**：Linux man page `sched_setaffinity(2)` — "sets the CPU affinity mask of the thread"。`mbind(2)` — "set the memory policy for a memory range"。Bovet & Cesati, *Understanding the Linux Kernel*, 3rd ed., Chapter 7 — NUMA。

### 4.5 三级绑核策略与 CPU 亲和性的间接效应

亲和性版 Actor 实现了精细的三级绑核：

**第一级：进程级绑核**（`__init__` 中）——将整个进程（含OpenVINO内部 TBB/OMP 线程）约束到指定核心。

**第二级：主线程释放**（`reset_thread_cpu_affinity`）——Ray gRPC 线程在 `__init__` 之前已创建，进程级绑核会约束它们。通过 `reset_thread_cpu_affinity` 将主线程释放回所有核。

**第三级：工作线程重新绑核**（`_process_loop` 开头）——推理工作线程重新绑定到指定核心，确保推理始终在指定核心上执行。

**间接效应**：绑核 → 影响 first-touch 触发者所在 CPU → 间接影响物理页落点。

**局限**：
1. 仅当 `MPOL_DEFAULT` + 拓扑正确时间接效应成立
2. 不直接控制物理页，内核仍可按自身策略分配
3. 在 VM 内（NUMA=1）间接效应**完全失效**

### 4.6 租约式 CPU 分配器

Infer Actor 通过集中式租约分配器 `NodeCpuAffinityAllocator` 协调同一节点上所有 Actor 的 CPU 分配：

```python
@ray.remote
class NodeCpuAffinityAllocator:
    def __init__(self, reserved_cpu_ids=None, audit_log_interval_s=30.0):
        self._lock = threading.Lock()
        available_cpu_ids = sorted(int(cpu_id) for cpu_id in os.sched_getaffinity(0))
        self._leases: dict[str, int] = {}           # owner_id → cpu_id
        self._reverse_leases: dict[int, str] = {}    # cpu_id → owner_id
```

分配器将 owner 分为三类：`sample:`（采样 Actor）、`infer:`（推理 Actor）、`other:`，在审计日志中分组显示。owner_id 命名为 `f"infer:{hero_id}:{actor_id}"`。

### 4.7 SCHED_FIFO 的尝试与收益/风险评估

```python
# 尝试将当前线程设为 SCHED_FIFO 实时调度
def try_set_sched_fifo(priority: int = 1) -> bool:
    try:
        param = os.sched_param(int(priority))
        os.sched_setscheduler(0, os.SCHED_FIFO, param)
        return True
    except (PermissionError, OSError, AttributeError):
        return False
```

SCHED_FIFO 是 Linux 实时调度策略，推理期间切换可确保推理线程不被 gRPC 线程抢占。**但需要 `CAP_SYS_NICE` capability**。历史诊断日志显示所有 `slow_infer` 事件中 `sched_fifo=False`——K8s 容器缺少该 capability。

**降级策略**：

```python
if not _sched_fifo_available:
    try:
        os.nice(-20)  # CFS nice=-20，权重 88776 vs 默认 1024
    except OSError:
        pass
```

`nice(-20)` 将 CFS 权重提升到 88776，同核心其他线程仅获约 1% CPU。但 CFS 是公平调度，仍会周期性切换（每时间片 1-10ms）。这解释了模式 A 中 `wall_ms ≈ engine_cpu_ms` 的现象。

> **文献背书**：Linux man page `sched(7)` — SCHED_FIFO 详解。CFS `prio_to_weight` 表（kernel/sched/core.c）。

**SCHED_FIFO 的副作用**：需要 `rt_runtime_us > 0`（K8s cgroup 配置）。配置过低（500000）：SCHED_FIFO 被 throttle，反而加剧延迟（p999 飙至 400-470ms）。配置过高（800000）：占用 rt 预算过多。**在 VM 环境下是"治标不治本"且有害的。**

### 4.8 系统层结论

- CPU 亲和性是业务层可控的杠杆，但不充分
- NUMA 内存亲和性缺失（未实现 `mbind`），是系统层的局部性缺口
- 在物理机（NUMA=2）上，配合 `numactl --membind` 可修复
- 但在 VM 内，系统层的修复能力被进一步削弱
- → 需进入微架构层与虚拟化层诊断

---

## 本篇小结与预告

通过应用层与系统层的诊断，我们已经揭示：SHM 通信架构的性能根植于物理页局部性，而 Ray 抽象无法提供 NUMA 局部性保证；系统层的 CPU 亲和性可以部分弥补，但 NUMA 内存亲和性的缺失和 VMware 虚拟化环境的拓扑欺骗，使得系统层的修复手段在 VM 内完全失效。

然而，真正令人震惊的尾延迟——同一 VMware 环境下，`rt_runtime_us` 配置从 950000 降到 500000 时，`p999_deschedule_ms` 从 0.02ms 飙升至 400-470ms，4 个数量级的差距——其物理根因尚未完全浮出水面。下一篇（中篇）将从微架构层和虚拟化层继续深入诊断，揭示 Cache 一致性问题、MESI 协议开销以及 VMware co-scheduling 互锁机制如何共同构成尾延迟的真正根源，并给出从 VMware 迁移到裸金属 + K8s 的完整论证与验证指标。
