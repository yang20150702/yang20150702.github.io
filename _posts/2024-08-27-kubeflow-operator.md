---
layout: post
title: "kubeflow分布式训练：training-operator的设计以及实现"
date: 2024-08-27
tag:
- kubeflow
- distribute training
- training-operator
- pytorch
comments: false
---

> 本文简单介绍了kubeflow的整体架构，重点关注模型训练training-operator；
> 以PytorchJob为例，介绍CRD(Custom Resource Definition)的设计以及实现

## kubeflow 简介

Kubeflow 是一个开源项目社区和生态系统，旨在解决机器学习 (ML) 生命周期中的每个阶段 ，并支持主流的开源工具和框架。**Kubeflow 使 Kubernetes 上的 AI/ML 变得简单、可移植且可扩展**。

Kubeflow 生态系统由多个开源项目组成，这些项目涉及 ML 生命周期的不同方面。其中许多项目设计为既可在 Kubeflow 平台内使用，也可独立使用。这些 Kubeflow 组件可以独立安装在 Kubernetes 集群上。

> 在我们的机器学习平台，我们单独使用 training-operator 组件支持模型训练和微调。

Kubeflow 平台是指与附加集成和管理工具捆绑在一起的全套 Kubeflow 组件。使用 Kubeflow 作为平台意味着为整个 ML 生命周期部署全面的 ML 工具包。

下图展示了Kubernetes 上覆盖 ML 生命周期每个阶段的主要 Kubeflow 组件：
![kubeflow平台](https://www.kubeflow.org/docs/started/images/kubeflow-intro-diagram.drawio.svg)

## 模型训练：Training Operator

Training Operator 是一个 Kubernetes 原生项目，支持使用各种 ML 框架（例如 PyTorch、TensorFlow、XGBoost等）创建的机器学习 (ML) 模型进行微调和可扩展的分布式训练。
用户可以将其他 ML 库（例如HuggingFace、 DeepSpeed或Megatron-LM） 与 Training Operator 集成，以在 Kubernetes 上协调他们的 ML 训练。

Training Operator 实现了集中式 Kubernetes 控制器来协调分布式训练作业；
负责调度适当的 Kubernetes 工作负载，为不同的 ML 框架实施各种分布式训练策略；
提供了一种在 Kubernetes 上运行分布式机器学习 (ML) 训练作业的简单而灵活的方法。

Training Operator 解决 AI/ML 生命周期中的模型训练和模型微调任务：
![模型训练](https://www.kubeflow.org/docs/components/training/images/ml-lifecycle-training-operator.drawio.svg)

使用 Training Operator 有如下优点：
+ 简化了运行分布式训练和微调的复杂性。用户可以专注于实现模型训练代码，使用 Training Operator 提供的 API 和接口轻松地将其模型训练从单机扩展到大规模分布式 Kubernetes 集群。
+ 具有可扩展性和可移植性。用户可以在拥有 Kubernetes 集群的任何云上部署 Training Operator，并且用户可以将不同的 ML 框架与 Training Operator 集成。
+ Training Operator 与 Kubernetes 生态系统相集成。用户可以利用 Kubernetes 的高级调度技术（例如 Kueue、Volcano 和 YuniKorn）与 Training Operator，以优化 ML 训练资源的成本。

Training Operator 对应 training-operator 代码库，其中实现了PytorchJob、TFJob、XGBoostJob、MPIJob、PaddleJob CRD。

接下来，以PytorchJob为例，介绍了CRD的实现原理，重点关注控制器原理的实现。


### PytorchJob：可以在k8s上运行分布式Pytorch jobs

PytorchJob 是在k8s上特定的CRD描述，training-operator提供了操作PytorchJob的Operator具体实现，可以自动管理 PyTorch 训练作业。

使用PyTorchJob，您可以将 PyTorch 作业定义和管理为 Kubernetes 自定义资源。然后，操作员将管理运行作业所需资源的创建、扩展和删除。这包括为 PyTorch 工作程序创建 pod、启动 PyTorch 分布式训练以及管理检查点。

PyTorchJob支持一系列 PyTorch 配置，包括单节点和多节点分布式训练、自动和手动扩展等。此外，它还支持一系列用于存储训练数据的存储后端，包括本地存储、NFS 和 Amazon S3 或 Google Cloud Storage 等云存储解决方案。

总体而言，PyTorchJob简化了在 Kubernetes 中运行分布式 PyTorch 作业的过程，从而更容易大规模管理训练工作负载。

开发 PytorchJob CRD以及Operator的整体流程分为如下步骤：
1. 预先定义 PytorchJob CRD(Custom Resource Definition)对象描述，用来描述Job resource（例如PyTorchJob 和 PyTorchJobList）：
   定义好的结构体需要额外添加一些标注；在init()方法中，使用 SchemeBuilder 注册 定义好的结构体 以及 初始化默认值的函数；对应 xxx_types.go和 xxx_defaults.go两个文件
2. 基于预定义的CRD描述，使用 controller-gen 来生成代码，包括apidoc、sdk、包含DeepCopy的code等。sdk包括informers和listers、clientset。 具体可以看 [Makefile](https://github.com/kubeflow/training-operator/blob/master/Makefile#L45https://github.com/kubeflow/training-operator/blob/master/Makefile#L45)
3. 创建 PyTorchJobReconciler 结构体，用来实现PytorchJob业务相关的Control逻辑：
   具体为Reconciler接口，基于controllerruntime进行实现 ControllerInterface 接口；ReconcileJobs方法处理通用的reconcile逻辑，用来reconcile job相关的pod和service（）
4. 对PyTorchJobReconciler进行初始化
5. 启动服务：创建Manager，初始化所有的Controllers，启动所有注册的controllers

接下来，详细分析一下 PytorchJobReconciler 的具体实现，回答一下问题：
+ Reconciler具体逻辑是什么？
+ Reconciler是如何被控制以及运行

PytorchJobReconciler定义如下：负责调谐 PytorchJob对象
```
// PyTorchJobReconciler reconciles a PyTorchJob object
type PyTorchJobReconciler struct {
	common.JobController
	client.Client
	Scheme    *runtime.Scheme
	Log       logr.Logger
	recorder  record.EventRecorder
	apiReader client.Reader
}
```

其中，training-operator提供了通用的JobController实现 common.JobController。JobController抽象所有的操作来管理Jobs的生命周期。
对于JobController，PyTorchJobReconciler需要实现ControllerInterface接口；初始化JobController对象作为PyTorchJobReconciler参数。然后调用ReconcileJobs方法。
**ReconcileJobs方法是触发job controller的reconcile逻辑的入口**。

PyTorchJobReconciler对象需要实现了ControllerInterface、Reconciler两个接口
+ ControllerInterface接口：定义了JobController需要的一些能力，需要自定义的Operator来实现
+ Reconciler接口：k8s调谐循环的核心（也就是控制器原理的核心）驱动集群的当前状态与期望状态一致

ControllerInterface接口描述如下：
```
// ControllerInterface defines the Interface to be implemented by custom operators. e.g. tf-operator needs to implement this interface
type ControllerInterface interface {
	// Returns the Controller name
	ControllerName() string

	// Returns the GroupVersionKind of the API
	GetAPIGroupVersionKind() schema.GroupVersionKind

	// Returns the GroupVersion of the API
	GetAPIGroupVersion() schema.GroupVersion

	// Returns the Group Name(value) in the labels of the job
	GetGroupNameLabelValue() string

	// Returns the Job from Informer Cache
	GetJobFromInformerCache(namespace, name string) (metav1.Object, error)

	// Returns the Job from API server
	GetJobFromAPIClient(namespace, name string) (metav1.Object, error)

	// GetPodsForJob returns the pods managed by the job. This can be achieved by selecting pods using label key "job-name"
	// i.e. all pods created by the job will come with label "job-name" = <this_job_name>
	GetPodsForJob(job interface{}) ([]*v1.Pod, error)

	// GetServicesForJob returns the services managed by the job. This can be achieved by selecting services using label key "job-name"
	// i.e. all services created by the job will come with label "job-name" = <this_job_name>
	GetServicesForJob(job interface{}) ([]*v1.Service, error)

	// DeleteJob deletes the job
	DeleteJob(job interface{}) error

	// UpdateJobStatus updates the job status and job conditions
	UpdateJobStatus(job interface{}, replicas map[apiv1.ReplicaType]*apiv1.ReplicaSpec, jobStatus *apiv1.JobStatus) error

	// UpdateJobStatusInApiServer updates the job status in API server
	UpdateJobStatusInApiServer(job interface{}, jobStatus *apiv1.JobStatus) error

	// SetClusterSpec sets the cluster spec for the pod
	SetClusterSpec(job interface{}, podTemplate *v1.PodTemplateSpec, rtype, index string) error

	// Returns the default container name in pod
	GetDefaultContainerName() string

	// Get the default container port name
	GetDefaultContainerPortName() string

	// Returns if this replica type with index specified is a master role.
	// MasterRole pod will have "job-role=master" set in its label
	IsMasterRole(replicas map[apiv1.ReplicaType]*apiv1.ReplicaSpec, rtype apiv1.ReplicaType, index int) bool

	// ReconcileJobs checks and updates replicas for each given ReplicaSpec of a job.
	// Common implementation will be provided and User can still override this to implement their own reconcile logic
	ReconcileJobs(job interface{}, replicas map[apiv1.ReplicaType]*apiv1.ReplicaSpec, jobStatus apiv1.JobStatus, runPolicy *apiv1.RunPolicy) error

	// ReconcilePods checks and updates pods for each given ReplicaSpec.
	// It will requeue the job in case of an error while creating/deleting pods.
	// Common implementation will be provided and User can still override this to implement their own reconcile logic
	ReconcilePods(job interface{}, jobStatus *apiv1.JobStatus, pods []*v1.Pod, rtype apiv1.ReplicaType, spec *apiv1.ReplicaSpec,
		replicas map[apiv1.ReplicaType]*apiv1.ReplicaSpec) error

	// ReconcileServices checks and updates services for each given ReplicaSpec.
	// It will requeue the job in case of an error while creating/deleting services.
	// Common implementation will be provided and User can still override this to implement their own reconcile logic
	ReconcileServices(job metav1.Object, services []*v1.Service, rtype apiv1.ReplicaType, spec *apiv1.ReplicaSpec) error

	// GetFrameworkName returns framework name (e.g., tensorflow).
	GetFrameworkName() string
}
```

Reconciler接口描述如下：
```
Reconciliation is level-based, meaning action isn't driven off changes in individual Events, but instead is
driven by actual cluster state read from the apiserver or a local cache.
For example if responding to a Pod Delete Event, the Request won't contain that a Pod was deleted,
instead the reconcile function observes this when reading the cluster state and seeing the Pod as missing.
*/
type Reconciler interface {
	// Reconcile performs a full reconciliation for the object referred to by the Request.
	//
	// If the returned error is non-nil, the Result is ignored and the request will be
	// requeued using exponential backoff. The only exception is if the error is a
	// TerminalError in which case no requeuing happens.
	//
	// If the error is nil and the returned Result has a non-zero result.RequeueAfter, the request
	// will be requeued after the specified duration.
	//
	// If the error is nil and result.RequeueAfter is zero and result.Requeue is true, the request
	// will be requeued using exponential backoff.
	Reconcile(context.Context, Request) (Result, error)
}
```

Reconcile方法的具体实现流程为：
+ 先获取current job spec为 pytorchJob; 
+ 先判断是否需要 reconciliation, 如果needReconcile is false and 删除时间戳不为空，不需要reconcile，直接返回；否则继续
+ 更新pytorchJob，设置默认值；
+ ReconcileHPA：a. 先获取期望的HPA；b. 根据objectKey获取目前的HPA; c. 如果 job is suspend，那么应该删除HPA；d. 判断expected == current语义相等，如果不相等，那么更新 expect HPA
+ ReconcileJobs：reconcile job相关的pod和service；
+ 判断 job被清理前duration时间是多少; if duration > 0返回结果：Requeue=true，RequeueAfter=t，告诉controller，在t时间后请求重新排队

其中，ReconcileJobs是ControllerInterface接口中的方法，该方法在common.JobController提供了默认实现（也可以重写）。
PyTorchJobReconciler复用了默认实现的 ReconcileJobs 方法。

`ReconcileJobs(job interface{}, replicas map[apiv1.ReplicaType]*apiv1.ReplicaSpec, jobStatus apiv1.JobStatus, runPolicy *apiv1.RunPolicy) error`

ReconcileJobs方法的具体实现流程为：
+ for every replica; execute ResetExpectations
+ 先判断jobStatus是否完成（包括JobSucceeded、JobFailed）
+ 基于runPolicy判断JobIsSuspended是否为true; 
+ 再次判断 job 是否为 IsSuspended；
+ 判断jobExceedsLimit是否为true，如果未超期，那么进行 scheduling，以及ReconcilePods和ReconcileServices; 
+ 更新jobStatus

> 到这里，我们看到了Reconcile内部的业务逻辑。接下来，如何调用执行 PyTorchJobReconciler 来完成调谐流程。

### PyTorchJobReconciler 如何被调用执行的

整体过程分为两步：
+ 使用 PyTorchJobReconciler 初始化 Controller，并将 controller 注册到 controllerManager
+ 由 controllerManager 启动注册好的 controller

#### PyTorchJobReconciler Controller初始化以及注册

PyTorchJobReconciler 是由 Controller 来调用的。
具体的业务逻辑在 SetupWithManager 方法中实现：

```
// SetupWithManager sets up the controller with the Manager.
func (r *PyTorchJobReconciler) SetupWithManager(mgr ctrl.Manager, controllerThreads int) error {
	c, err := controller.New(r.ControllerName(), mgr, controller.Options{
		Reconciler:              r,
		MaxConcurrentReconciles: controllerThreads,
	})
	if err != nil {
		return err
	}

	// using onOwnerCreateFunc is easier to set defaults
	if err = c.Watch(source.Kind(mgr.GetCache(), &kubeflowv1.PyTorchJob{}), &handler.EnqueueRequestForObject{},
		predicate.Funcs{CreateFunc: r.onOwnerCreateFunc()},
	); err != nil {
		return err
	}

	// eventHandler for owned object
	eventHandler := handler.EnqueueRequestForOwner(mgr.GetScheme(), mgr.GetRESTMapper(), &kubeflowv1.PyTorchJob{}, handler.OnlyControllerOwner())
	predicates := predicate.Funcs{
		CreateFunc: util.OnDependentCreateFunc(r.Expectations),
		UpdateFunc: util.OnDependentUpdateFunc(&r.JobController),
		DeleteFunc: util.OnDependentDeleteFunc(r.Expectations),
	}
	// Create generic predicates
	genericPredicates := predicate.Funcs{
		CreateFunc: util.OnDependentCreateFuncGeneric(r.Expectations),
		UpdateFunc: util.OnDependentUpdateFuncGeneric(&r.JobController),
		DeleteFunc: util.OnDependentDeleteFuncGeneric(r.Expectations),
	}
	// inject watching for job related pod
	if err = c.Watch(source.Kind(mgr.GetCache(), &corev1.Pod{}), eventHandler, predicates); err != nil {
		return err
	}
	// inject watching for job related service
	if err = c.Watch(source.Kind(mgr.GetCache(), &corev1.Service{}), eventHandler, predicates); err != nil {
		return err
	}
	// skip watching volcano PodGroup if volcano PodGroup is not installed
	if _, err = mgr.GetRESTMapper().RESTMapping(schema.GroupKind{Group: v1beta1.GroupName, Kind: "PodGroup"},
		v1beta1.SchemeGroupVersion.Version); err == nil {
		// inject watching for job related volcano PodGroup
		if err = c.Watch(source.Kind(mgr.GetCache(), &v1beta1.PodGroup{}), eventHandler, genericPredicates); err != nil {
			return err
		}
	}
	// skip watching scheduler-plugins PodGroup if scheduler-plugins PodGroup is not installed
	if _, err = mgr.GetRESTMapper().RESTMapping(schema.GroupKind{Group: schedulerpluginsv1alpha1.SchemeGroupVersion.Group, Kind: "PodGroup"},
		schedulerpluginsv1alpha1.SchemeGroupVersion.Version); err == nil {
		// inject watching for job related scheduler-plugins PodGroup
		if err = c.Watch(source.Kind(mgr.GetCache(), &schedulerpluginsv1alpha1.PodGroup{}), eventHandler, genericPredicates); err != nil {
			return err
		}
	}
	return nil
}
```

整体逻辑为：
1. 使用 ctrlMgr、reconciler 来初始化controller对象c，将controller对象c注册到 ctrlManager中
2. c调用Watch方法来获取来自 `&kubeflowv1.PyTorchJob{}`，`&corev1.Pod{}`，`&corev1.Service{}`的事件
3. 如果 volcano PodGroup 没有安装，跳过 watching volcano PodGroup；通过调用`mgr.GetRESTMapper().RESTMapping(schema.GroupKind{Group: v1beta1.GroupName, Kind: "PodGroup"}`检查 RESTMapping
4. 如果 scheduler-plugins PodGroup 没有安装，跳过 watching scheduler-plugins PodGroup

核心逻辑是Watch方法：`Watch(src source.Source, eventhandler handler.EventHandler, predicates ...predicate.Predicate) error`

Watch方法接收 Source 提供的事件，使用 EventHandler 来排队 reconcile.Requests 响应事件（可以针对特定的Object的请求进行排队）；
在events传递到到 EventHandler之前，Watch方法 也提供了多个 Predicates 用来过滤events；如果所有提供的 Predicated返回的结果均为true，那么 events将会传递到 EventHandler

Source接口的实现有 Kind、Informer、Channel等，对应的逻辑在：[controller-runtime/pkg/source](https://github.com/kubernetes-sigs/controller-runtime/blob/main/pkg/source/source.go#L37)

#### controllerManager 启动已经注册 PyTorchJobReconciler controller

`type ReconcilerSetupFunc func(manager manager.Manager, gangSchedulingSetupFunc common.GangSchedulingSetupFunc, controllerThreads int) error`
该函数是一个通用的模版方法，可以初始化不同CRD的 Reconciler。

ControllerManager的初始化以及启动逻辑如下：
```
mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{
  Scheme: scheme,
  Metrics: metricsserver.Options{
      BindAddress: metricsAddr,
  },
  WebhookServer: webhook.NewServer(webhook.Options{
      Port: webhookServerPort,
  }),
  HealthProbeBindAddress: probeAddr,
  LeaderElection:         enableLeaderElection,
  LeaderElectionID:       leaderElectionID,
  Cache:                  cacheOpts,
})
if err != nil {
  setupLog.Error(err, "unable to start manager")
  os.Exit(1)
}

// Set up controllers using goroutines to start the manager quickly.
go setupControllers(mgr, enabledSchemes, gangSchedulerName, controllerThreads, certsReady)

//+kubebuilder:scaffold:builder

setupLog.Info("starting manager")
if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
  setupLog.Error(err, "problem running manager")
  os.Exit(1)
}
```

#### 小结

在 PyTorchJobReconciler 被调用执行过程中，涉及核心对象 Controller、ControllerManager、GangSchedulingSetupFunc等，
这些对象之间的调用关系如图：
![调用关系](/img/pytorchJobReconcile.drawio.svg)

### 其他

> [controller-runtime](https://github.com/kubernetes-sigs/controller-runtime) 提供了一些开发k8s项目需要的一些公共能力，其中包括source、controller、manager、leaderElection等。

上述只是介绍PytorchJobReconciler是如何实现以及运行的。这只是training-operator核心业务能力之一，TFJob等CRD的 Reconciler 实现不一一介绍。

除了核心的业务能力，training-operator作为kubeflow的核心服务，在实际使用中通常会部署多个实例来处理更多的请求。如果多个实例同时在调用 k8s API进行读写操作时，此时就需要考虑一致性的问题。
training-operator在多实例运行时支持 LeaderElection 的操作。

### 小结

CRD(Custom Resource Definition)是CR(Custom Resource)的定义，CR是对 k8s API的扩展，CR可以动态注册到集群中。

CR只是描述资源的数据，还需要将CR与CR Controller相结合，CR才能提供真正的**声明式API**。

> k8s的声明式API 强制对职权进行了分离操作。先声明资源的期望状态，k8s Controller使k8s对象的当前状态与声明的期望状态保持同步。
> 
> Operator模式：将 CR 与 CR Controller相结合。Operator利用CR来管理应用以及其组件。

Operator 模式 旨在记述（正在管理一个或一组服务的）运维人员的关键目标。 这些运维人员负责一些特定的应用和 Service，他们需要清楚地知道系统应该如何运行、如何部署以及出现问题时如何处理。

在 Kubernetes 上运行工作负载的人们都喜欢通过自动化来处理重复的任务。 Operator 模式会封装你编写的（Kubernetes 本身提供功能以外的）任务自动化代码。

Kubernetes 的 Operator 模式概念允许你在不修改 Kubernetes 自身代码的情况下， 通过为一个或多个自定义资源关联控制器来扩展集群的能力。 Operator 是 Kubernetes API 的客户端， 充当自定义资源的控制器。


## 使用Pytorch进行分布式训练实践

Pytorch支持单机训练、普通分布式训练、基于torchrun 弹性分布式训练三种模式

## 总结

本文以 PytorchJob CR为例，详细介绍了 PytorchJobReconcile的实现，基于controller-runtime的Controller和Controller-Manager组件完成了Controller初始化以及启动。
同时梳理了 Reconciler、Controller、ControllerManager、GangSchedulingSetupFunc对象之间的关系，明白了Operator要解决的问题以及内部的实现原理。

> 在介绍核心接口的具体实现时，我只介绍核心逻辑，有一些详细细节并未覆盖。如果感兴趣的话，可以详细阅读源码。

## 参考

1. [Operator模式](https://kubernetes.io/zh-cn/docs/concepts/extend-kubernetes/operator/)
2. [kubeflow](https://www.kubeflow.org/)