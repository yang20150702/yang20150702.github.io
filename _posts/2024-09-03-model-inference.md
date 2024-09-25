---
layout: post
title: "vllm是如何支持大模型分布式推理？"
date: 2024-08-28
tag:
- 分布式计算架构
- training-operator
- pytorch
comments: false
mathjax: true
---
LLM 只能逐个采样并生成新 token，并且每个新 token 的生成过程都依赖于该序列中所有先前的 token，具体来说是它们的key和value vectors。

在这个顺序生成过程中，已有 token 的key和value向量通常会被缓存以用于生成未来的 token，这称为 KV 缓存。

请注意，**一个 token 的 KV 缓存依赖于其所有之前的 token。这意味着出现在序列中不同位置的同一 token 的 KV 缓存将有所不同**。

## 模型推理（模型服务化）

模型服务：将模型部署为生成式LLM服务，输入user prompt，LLM服务生成output token列表，并转换为输出序列。

给定一个请求的prompt，LLM服务的生成计算能够被拆解为两个阶段：
+ prompt阶段：将整个user prompt $(x_1, ..., x_n)$ 作为输入，并计算第一个新token的概率 $P(x_{n+1}| x_1, ..., x_n)$。
  在此过程中，也生成 key 向量$(k_1, ..., k_n)$，和 value 向量 $(v_1, ..., v_n)$。因为prompt token是已知的，prompt阶段可以使用矩阵乘法操作进行并行计算。**这个阶段可以有效地利用GPU的并行计算能力。**
+ 自回归生成阶段：按顺序生成剩余新的 token。
  由于数据依赖，不同迭代的计算是不能并行的，计算通常使用矩阵向量乘法，这是低效的。**这个阶段并没有重复利用GPU计算，并且是memory-bound，这是单个请求延迟的大部分原因。**

LLM 已在文本生成、摘要、语言翻译等任务中展现出其价值。然而，使用传统 LLM 推理方法部署这些模型存在一些局限性：
+ 高内存占用: LLM 需要大量内存来存储其参数和中间激活，这使得它们在资源受限的环境中部署起来具有挑战性。
+ 吞吐量有限: 传统实现难以处理大量并发推理请求，影响了可扩展性和响应能力。这会影响 LLM 在生产服务器上的性能，并限制其与 GPU 的效率。 
+ 计算成本: LLM 推理中涉及的大量矩阵计算可能非常昂贵，尤其是在大型模型上。高内存要求和低吞吐量进一步增加了计算成本。

## vllm

> 先弄清楚vllm解决的问题，然后，理解核心架构设计；最后阅读源码来深入理解核心能力设计

> 1. 简介； 2. 整体架构，分层架构以及核心能力模块；3. 核心能力模块，如何解决架构设计中的分布式推理问题 + 高吞吐
> 2. 核心模块之间的依赖关系需要梳理出来，串联模型推理的核心流程

vLLM是一基于 PagedAttention 的高吞吐量分布式 LLM 服务引擎，用于LLM推理服务化，可实现 KV 缓存内存的近乎零浪费。
它支持连续批处理以提高吞吐量和 GPU 利用率；PagedAttention可以解决内存瓶颈问题，可以有效地管理Attention key and value。

与传统的 LLM 服务方法相比，vLLM 有几个优势：
+ 支持张量并行和pipeline并行用于分布式推理
+ 更高的吞吐量：采用多种解码算法实现高吞吐量服务，包括并行采样、beam search等
+ 降低内存使用率：与传统的 LLM 服务方法相比，vLLM 所需的内存明显更少，因此可以在硬件有限的平台上部署。
+ OpenAI 兼容 API：vLLM 提供了与 OpenAI 兼容的 API，从而可以轻松地与现有的 LLM 应用程序集成。
+ 与 Hugging Face 模型无缝集成。
+ 高效的 GPU 利用率: vLLM 旨在充分利用现代 GPU。它最大限度地减少了 CPU 和 GPU 之间的数据传输，并优化了 GPU 内存和计算资源的使用。通过在 GPU 上保留更多模型和数据，它可以减少延迟并提高吞吐量。
+ 并行性：vLLM 在其操作中融入了并行性。它同时处理模型的不同部分和推理管道的不同阶段。这种并行处理减少了完成推理任务所需的总体时间。

vLLM的架构如图：
![vllm system](/img/vllm-system.png)

vLLM使用中心化的scheduler来协调分布式GPU workers的执行。KV cache manager通过 PageAttention 以分页的方式高效管理KV cache。
KV cache manager也通过中央调度器发送的指令来管理GPU workers上的物理KV cache memory。

### PagedAttention：vLLM 的基石

LLM推理服务系统的吞吐量是受内存限制的。克服这种内存限制需要解决内存管理中的以下挑战：
+ large KV Cache
+ 复杂的解码算法
+ 针对未知输入和输出长度进行调度

PagedAttention 是 vLLM 在 LLM 优化方面的核心优势。与使用连续内存分配的传统 LLM 不同，PagedAttention 受操作系统分页概念的启发，允许在非连续内存空间存储连续的key和value。
PageAttention将每个序列的KV cache划分为KV block。每个block包含固定数量token的key and value向量。

在Attention计算过程中, the PagedAttention kernel 会高效地识别和获取这些 block.

由于block在内存中不需要连续，因此我们可以像在操作系统的虚拟内存中一样以更灵活的方式管理键和值：可以将block视为页面page，将token视为字节byte，将序列视为进程。序列的连续逻辑block通过block table映射到非连续物理块。物理块在生成新令牌时按需分配。

在 PagedAttention 中，内存浪费仅发生在序列的最后一个块中。实际上，这会导致接近最佳的内存使用率，浪费率仅为 4% 以下。内存效率的提高被证明是非常有益的：它允许系统将更多序列批量处理在一起，提高 GPU 利用率，从而显著提高吞吐量，

PagedAttention 还有一个关键优势：高效的内存共享。例如，在并行采样中，同一个提示会生成多个输出序列。在这种情况下，输出序列之间可以共享prompt的计算和内存。

PagedAttention 通过其block table自然地实现了内存共享。与进程共享物理页面的方式类似，PagedAttention 中的不同序列可以通过将其逻辑块映射到同一物理块来共享块。
为了确保安全共享，PagedAttention 会跟踪物理块的引用计数并实现写时复制机制。

PageAttention 的内存共享功能大大降低了复杂采样算法（例如并行采样和beam search）的内存开销，最多可减少 55% 的内存使用量。这可以转化为高达 2.2 倍的吞吐量提升。这使得此类采样方法在 LLM 服务中变得实用。

在自回归解码过程中，LLM 的所有输入token都会生成其attention key和value tensor，这些张量保存在 GPU 内存中以生成下一个标记。

#### vllm PageAttention

目前，vLLM 使用其自己的多头查询注意kernel实现（csrc/attention/attention_kernels.cu）。此内核旨在与 vLLM 的分页 KV 缓存兼容，
其中键和值缓存存储在单独的block中（请注意，此块概念与 GPU 线程块不同。因此，在后面的文档中，我将 vLLM 分页注意块(paged attention block)称为“块”，而将 GPU 线程块称为“线程块”）。

### 连续批处理和迭代级调用

连续批处理和迭代级调度是 vLLM 优化 LLM 服务的关键。与批大小保持不变的静态批处理不同，连续批处理会动态调整。这种动态方法通常称为动态或迭代级调度，允许立即注入请求，从而提高吞吐量。

两者的区别很明显：静态批处理在整个推理过程中保持批处理大小恒定，从而可能导致效率低下。相比之下，动态批处理会根据实时需求进行调整，从而最大限度地提高计算资源利用率。

从实际角度来看，动态批处理可确保 LLM 的响应时间更快，并增强可扩展性。这意味着 LLM 服务更高效、更具成本效益，尤其是在要求高吞吐量和低延迟的场景中。

### 分布式执行

许多LLM的参数量超过了单个GPU的容量。因此，有必要将LLM模型分片到分布式GPU上，并且以 模型并行（MP）方式执行。

这需要一个能够处理分布式内存的 内存管理器。vLLM 在分布式设置中非常高效，因为它支持 Transformers 上广泛使用的 Megatron-LM 样式张量模型并行策略。
该策略遵循 SPMD（单程序多数据）执行计划，其中**线性层被划分为执行块矩阵乘法**，并且 GPU 通过 allreduce 操作不断同步中间结果。
具体而言，注意力运算符在注意力头维度上被拆分，每个 SPMD 进程负责多头注意力中的注意力头子集。

我们观察到，即使使用模型并行执行，每个模型分片仍然处理同一组输入令牌，因此需要 KV Cache 来处理相同的位置。
因此，vLLM 在集中式调度程序中具有单个 KV cache Manager，如图所示：
![vllm system](/img/vllm-system.png)

不同的 GPU Worker 共享管理器，以及从逻辑块到物理块的映射。这种通用映射允许 GPU workers 使用调度程序为每个输入请求提供的物理块来执行模型。
虽然每个 GPU worker 都有相同的物理块 ID，但 worker 只为其相应的注意头存储一部分 KV 缓存。

在每个步骤中，调度程序首先为批处理中的每个请求准备带有输入token ID 的消息，以及每个请求的 block table。
接下来，调度程序将此控制消息广播给 GPU worker。然后，GPU worker开始使用输入token ID 执行推理。
在注意力层中，GPU worker根据控制消息中的block table读取 KV 缓存。
在执行过程中，GPU worker 使用all-reduce通信原语同步中间结果，而无需调度程序的协调。
最后，GPU worker 将此迭代的采样token发送回调度程序。

总之，GPU worker 不需要在内存管理上进行同步，因为它们只需要在每次解码迭代开始时接收所有内存管理信息以及 step input

#### 分布式并行策略

对于何时使用分布式推理，常见的做法是：
+ 单 GPU（无分布式推理）：如果模型适合单个 GPU，则可能不需要使用分布式推理。只需使用单个 GPU 运行推理即可。
+ 单节点多 GPU（张量并行推理）：如果您的模型太大而无法容纳单个 GPU，但它可以容纳具有多个 GPU 的单个节点，则可以使用张量并行。张量并行大小是您要使用的 GPU 数量。例如，如果您在单个节点中有 4 个 GPU，则可以将张量并行大小设置为 4。
+ 多节点多 GPU（张量并行+流水线并行推理）：如果您的模型太大而无法容纳单个节点，则可以将张量并行与流水线并行一起使用。张量并行大小是您想要在每个节点中使用的 GPU 数量，而管道并行大小是您想要使用的节点数量。

例如，如果您在 2 个节点中有 16 个 GPU（每个节点 8 个 GPU），则可以将张量并行大小设置为 8，将管道并行大小设置为 2。

简而言之，tensor parallel大小应为每个节点中的 GPU 数量，而pipeline parallel大小应为节点数量。

> 有一种极端情况：如果模型适合具有多个 GPU 的单个节点，但 GPU 数量无法均匀划分模型大小，则可以使用管道并行性，它沿层分割模型并支持不均匀分割。
> 在这种情况下，张量并行大小应为 1，管道并行大小应为 GPU 数量。

#### Details for Distributed Inference and Serving

vLLM 支持分布式张量并行推理和服务。目前，我们支持 Megatron-LM 的张量并行算法。我们还支持管道并行作为在线服务的测试版功能。
我们使用 Ray 或 python 原生多进程  来管理分布式运行时。在单个节点上部署时可以使用多进程，多节点推理目前需要 Ray。

当不在 Ray placement group中运行时，如果同一节点上有足够的 GPU 可用于配置的 tensor_parallel_size，则默认使用多进程，否则将使用 Ray。
可以通过 LLM 类 `distributed-executor-backend`参数或 `--distributed-executor-backend` API server参数覆盖此默认值。
将其设置为 mp 表示多进程或 ray 表示 Ray。对于多进程情况，不需要安装 Ray。

对于多节点推理以及服务化，推荐的方法是使用 docker 镜像来确保相同的环境，并通过将它们映射到相同的 docker 配置中来隐藏主机的异构性。

#### Speculative Decoding: 推测解码

Speculative decoding is a technique which improves inter-token latency in memory-bound LLM inference.

由于 Transformer 架构的自回归特性，有时 KV 缓存空间不足以处理所有批处理请求。vLLM 可以抢占请求以释放 KV 缓存空间用于其他请求。
当再次有足够的 KV 缓存空间可用时，将重新计算被抢占的请求。

vLLM supports an experimental feature chunked prefill. Chunked prefill allows to chunk large prefills into smaller
chunks and batch them together with decode requests.

The quantization process involves four main steps:
1. Loading the model
2. Preparing calibration data，准备校准数据
3. Applying quantization
4. Evaluating accuracy in vLLM，评估 vLLM 中的准确性

Start with 512 samples for calibration data (increase if accuracy drops)
• Use a sequence length of 2048 as a starting point
• Employ the chat template or instruction template that the model was trained with
• If you’ve fine-tuned a model, consider using a sample of your training data for calibration

自动前缀缓存（简称 APC，Automatic Prefix Caching）会缓存现有查询的 KV 缓存，这样如果新查询与现有查询之一共享相同的前缀，它就可以直接重用 KV 缓存，从而允许新查询跳过共享部分的计算。

## 参考

1. [vllm doc pdf](https://vllm.readthedocs.io/_/downloads/en/latest/pdf/)
2. [vllm paper](https://arxiv.org/pdf/2309.06180)
3. [vLLM 和 PagedAttention 简介](https://blog.runpod.io/introduction-to-vllm-and-how-to-run-vllm-on-runpod-serverless/)
4. [vLLM: Easy, Fast, and Cheap LLM Serving with PagedAttention](https://blog.vllm.ai/2023/06/20/vllm.html)
5. [连续批处理如何实现 LLM 推理 23 倍吞吐量并降低 p50 延迟](https://www.anyscale.com/blog/continuous-batching-llm-inference?trk=public_post_comment-text)
6. [vllm docs](https://docs.vllm.ai/en/latest/)