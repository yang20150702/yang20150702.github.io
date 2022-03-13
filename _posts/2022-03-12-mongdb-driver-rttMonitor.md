---
layout: post
title: "mongo-go-driver中RTTMonitor"
date: 2022-03-12
tag:
- mongoDB
comments: false
---

本文介绍mongodb-go-driver中RTTMonitor模块的设计以及实现。

RTT(Round-Trip Time)在计算机中表示进行一次网络请求需要的往返时间。

RTTMonitor的工作原理为：在固定的时间间隔内，向Server发起Hello(heartbeat)，同时记录对应的RTT为一个采样。
其中，minRTT是采样samples中的最小值；如果samples的样本数量小于5或者为0，则返回0。
对于averageRTT，每次采样完成都需要进行计算，其的计算公式为：rttAlphaValue*(rtt)+(1-rttAlphaValue)*(r.averageRTT)。
该公式同时使用了历史的averageRTT和当前的RTT，这种计算方式更具参考价值。

RTTMonitor统计出来的averageRTT、minRTT主要用于LatencySelector算法中。

RTTMonitor 作为Topology下Server的一个属性，需要在server调用Connect函数时启动rttMonitor；并在server调用DisConnect时关闭rttMonitor。
相关的配置参数为：monitoringDisabled 和 loadBalanced，这两参数同时为false时，rttMonitor才会运行。
```
	if !s.cfg.monitoringDisabled && !s.cfg.loadBalanced {
		s.rttMonitor.connect()
		s.closewg.Add(1)
		go s.update()
	}
```

RTTMonitor的定义

```
const (
	rttAlphaValue = 0.2
	minSamples    = 5
	maxSamples    = 500
)

type rttConfig struct {
	interval           time.Duration
	minRTTWindow       time.Duration // Window size to calculate minimum RTT over.
	createConnectionFn func() *connection
	createOperationFn  func(driver.Connection) *operation.Hello
}

type rttMonitor struct {
	mu            sync.RWMutex // mu guards samples, offset, minRTT, averageRTT, and averageRTTSet
	samples       []time.Duration
	offset        int
	minRTT        time.Duration
	averageRTT    time.Duration
	averageRTTSet bool

	closeWg  sync.WaitGroup
	cfg      *rttConfig
	ctx      context.Context
	cancelFn context.CancelFunc
}
```

RTTMonitor提供的接口有：
+ connect()
+ disconnect()
+ getRTT()：获取某段时间内平均RTT
+ getMinRTT()：获取某段时间内最小RTT
+ runHello()：执行hello操作，记录RTT，并计算averageRTT、minRTT