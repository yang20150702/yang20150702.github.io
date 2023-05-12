---
layout: post
title: "在Github上将原仓库新建的分支同步到fork仓库中"
date: 2023-05-12
tag:
- github
comments: false
---

问题描述：在Github上将原仓库新建的分支同步到fork仓库中

具体的解决步骤如下：

1. 与源仓库建立关系

   `git remote add stream git@github.com:apache/dubbo-rust.git`

2. 拉取源仓库的数据

   `git fetch upstream`

3. 新建本地分支，并与远程分支建立追踪关系

   `git checkout -b feat/cluster --track upstream/feat/cluster`

   `git branch -vv`：可以看到二者已经建立关系

4. 将新建的本地分支推送到自己的fork仓库中，在github上可以看到该分支

   `git push origin feat/cluster`
   
5. 再次更新本地分支的track关系

   `git branch -u origin/feat/cluster`

ChatGPT 给出的解决方案：

在Github上，如果您想将原始仓库中的新分支同步到fork仓库中，可以按照以下步骤操作：

1. 打开您的fork仓库页面，在页面顶部选择“Pull requests（拉取请求）”选项卡。

2. 点击“New pull request（新建拉取请求）”按钮。

3. 在“Comparing changes（比较更改）”页面中，选择原始仓库的新分支作为“base（基础分支）”，并选择您的fork仓库的相应分支作为“compare（比较分支）”。

4. 点击“Create pull request（创建拉取请求）”按钮。这将创建一个新的拉取请求，用于将原始仓库的新分支合并到您的fork仓库中。

5. 在确认拉取请求的更改后，单击“Merge pull request（合并拉取请求）”按钮以将原始仓库的新分支合并到您的fork仓库中。

6. 最后，使用git命令更新您的本地仓库。在您的本地仓库文件夹中运行以下命令：

   ```
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```

   这将从原始仓库获取最新更改，并将它们合并到您的本地分支中。

以上步骤将能帮助您将原始仓库中的新分支同步到您的fork仓库中，并确保您的本地仓库与最新更改同步。