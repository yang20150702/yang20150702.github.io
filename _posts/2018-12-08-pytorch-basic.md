# Pytorch的基础概念和操作
---
layout: post
title: "Pytorch的基础概念和操作"
date: 2018-12-08
tag:
- pytorch
comments: true
---

通过阅读Pytorch docs知道，pytorch是基于python的科学计算package：作为numpy的替代者，能够使用GPU进行运算；作为一个深度学习研究平台，提供最大限度的灵活性和速度。

要使用pytorch来实现深度学习算法，首先需要了解它的基础概念和函数。接下来简要介绍一下。

+ Tensor的概念和操作
+ autograd：自动微分

## Tensor

`torch.Tensor`是一种包含单一数据类型的多维矩阵，提供了tensor的基础操作。

tensor类似于numpy的`ndarrays`，除此之外，tensors可以使用GPU来加速计算。默认的tensor类型是`torch.FloatTensor`类型。

`torch.Tensor`中提供了8种CPU tensor类型和GPU tensor类型。

### tensor的创建方法

```
In[2]: import torch
In[3]: x = torch.empty(5, 3)   # 创建一个未初始化的matrix
In[4]: x = torch.rand(5, 3)    # 创建一个随机初始化的matrix
In[5]: x = torch.zeros(5, 3, dtype=torch.long)
In[6]: x
Out[6]:
tensor([[0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]])
In[7]: x = torch.tensor([5.5, 3])   # 通过显式传值来创建tensor
In[8]: x = torch.tensor((5.5, 3))
In[9]: x
Out[9]: tensor([5.5000, 3.0000])
# 基于已经存在的tensor，创建一个新的tensor，使用torch.new_xxx, torch.xxx_like之类的函数
In[10]: x.new_ones(5, 3, dtype=torch.double)
Out[10]:
tensor([[1., 1., 1.],
        [1., 1., 1.],
        [1., 1., 1.],
        [1., 1., 1.],
        [1., 1., 1.]], dtype=torch.float64)
In[11]: x = torch.randn_like(x, dtype=torch.float)
In[12]: x
Out[12]: tensor([-0.0546,  1.1731])
In[15]: x = x.new_ones(5, 3, dtype=torch.double)
In[16]: x
Out[16]:
tensor([[1., 1., 1.],
        [1., 1., 1.],
        [1., 1., 1.],
        [1., 1., 1.],
        [1., 1., 1.]], dtype=torch.float64)
In[17]: x = torch.randn_like(x, dtype=torch.float)
In[18]: x
Out[18]:
tensor([[-1.5906, -0.1074,  1.2048],
        [ 0.3437, -0.9294, -0.4050],
        [ 0.2360,  0.5307, -0.5297],
        [-1.4917, -0.2375, -0.4867],
        [ 0.7149,  0.6911, -0.2691]])
In[19]: x.shape
Out[19]: torch.Size([5, 3])
In[20]: x.size()
Out[20]: torch.Size([5, 3])
```

### 操作

> torch提供了两种类型的函数操作：一种是`In-place`就地修改的；另一种是`Out-of-place`操作；
  例如， add()是`In-place`操作，`add_()`是`Out-of-place`操作。

1. 支持和numpy同样的索引操作
2. Resizing:改变tensor的大小，使用`torch.view`
3. 若tensor有一个元素，可以使用`.item()`来获取值
4. 更多的tensor操作：见 [torch库](https://pytorch.org/docs/master/tensors.html)

### Numpy array类型变量和 torch tensor之间的转换

Tensor和numpy array共享它们拥有同一内存地址，改变其中一个，另一个也会发生相应的改变。

Tensor转换为numpy array操作如下：
```python
In[64]: a = torch.ones(3)
In[65]: print(a)
tensor([1., 1., 1.])
In[66]: b = a.numpy()
In[67]: print(b)
[1. 1. 1.]
In[68]: a.add_(1)
Out[68]: tensor([2., 2., 2.])
In[69]: a, b
Out[69]: (tensor([2., 2., 2.]), array([2., 2., 2.], dtype=float32))
```

Numpy array转换为tensor操作，如下：
```python
In[70]: import numpy as np
In[71]: a = np.ones(3)
In[72]: b = torch.from_numpy(a)
In[73]: np.add(a, 1, out=a)
Out[73]: array([2., 2., 2.])
In[74]: a, b
Out[74]: (array([2., 2., 2.]), tensor([2., 2., 2.], dtype=torch.float64))
```

通过上述代码，可以看出，同一变量的tensor类型和numpy array类型共享同一内存地址。

## Autograd package：自动微分

`autograd`是pytorch中所有神经网络的核心，它为tensor上的所有操作提供了自动微分。它是`define-by-run`的框架，这意味着反向传播是由代码的运行方式来定义，每次迭代都可以不同。

tensor是pytorch的核心数据结构，如果设定tensor变量的属性`.requires_grad`为`True`，autograd会跟踪tensor上的所有操作。当模型完成前向传播计算时，调用`.backward()`并自动计算梯度。tensor的梯度保存在`.grad`属性中。

如果想要阻止autograd 跟踪`.required_grad=True`的tensor的History，可以使用`with torch.no_grad()`来实现。

在tensor上调用`.backward()`，可以用来计算导数。

> 导数和梯度，都用来表示因变量针对自变量的变化率。

Tensor和Function互相连接并构建一个非循环图，它编码完整的计算历史。
每个tensor都有一个`.grad_fn`属性，该属性引用已创建tensor的Function（除了用户创建的tensors，它们的`grad_fn`属性为None）。

## 神经网络

torch.nn`用于构造神经网络模型。`nn`依赖`autograd`来定义模型并进行自动微分。
