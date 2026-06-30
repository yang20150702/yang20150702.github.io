---
layout: post
title: "langgraph设计解读-简介以及示例"
date: 2024-04-22
tag:
- langgraph
- agent
- langchain
- multi-Agent
comments: false
---

> 2024年，随着OpenAI的Assistants API广泛使用，智谱、百度文心一言等大模型开始大力主推Agent，Agent在业界引起了极大的影响。其中，有一些AI领域大佬很认同Agent的未来前景：比如，Andrew Ng(吴恩达)在3月份分享的 AI agentic workflows;
> 
> 作为AI从业者，我们快速落地了 Agent 在业务场景中的应用；同时，也非常看好 multi-Agent 在未来业务中的落地场景并正在落地，
> 
> 目前，我正在持续关注 langgraph、autoGen、Camel、AgentX 等Agent开源项目的进展。 我会分享一些开源Agent的应用以及设计原理

### langgraph 简介

langgraph 是一个使用LLM来构建有状态的、multi-actor应用程序的库。
它扩展了 LangChain Expression Language的能力，能够以循环的方式跨多个计算step来协调多个chains(或者actors)。
langgraph 的灵感来自 Pregel 和 Apache Beam。暴露的接口借鉴了 NetworkX。

> Pregel 是由Google发布的大规模图处理系统，基于BSP(Bulk Synchronous Parallel，整体同步并行)模型来实现。
> Apache Beam：一个用于定义批处理和流数据并行处理管道的统一模型。
> NetworkX是一个 Python 包，用于创建、操作和研究复杂网络的结构、动态和功能。

langgraph的核心点是为LLM应用程序添加了循环。
+ 对于单Agent的行为，循环是核心功能，其核心流程是：循环调用LLM来确定下一步该如何做。
+ 对于multi-Agent的场景，循环也是核心功能，其核心流程是：多个Agent之间需要进行多轮会话。

相比于langgraph，langchain构建的LLM应用是一种DAG工作流程，也就是说，某个功能调用结束后不能再次调用，除非手动进行了特殊处理（比如AgentExecutor）。
langchain提供内置的LECL语言来支持DAG工作流程，并针对性地进行了优化。注意：langgraph并未针对DAG流程进行优化，建议用langchain来构建DAG工作流程。

> 对于langchain提供的 AgentExecutor，langgraph可以实现同样的能力，具体见 示例

### 示例

具体的含义请参考 [langgraph](https://python.langchain.com/docs/langgraph/#documentation)

#### AgentExector

用 langgraph 复现了 langchain 提供的 AgentExecutor实现。

> 代码自测可运行，需要替换你的OpenAI LLM配置参数

```python
import operator
from typing import TypedDict, Annotated, Union

from langchain import hub
from langchain.agents import create_openai_functions_agent
from langchain_community.chat_models import AzureChatOpenAI
from langchain_core.agents import AgentAction
from langchain_core.agents import AgentFinish
from langchain_core.messages import BaseMessage
from langchain_core.tools import tool
from langgraph.graph import END, StateGraph
from langgraph.prebuilt.tool_executor import ToolExecutor


@tool
def multiply(first_number: int, second_number: int):
    """Multiplies two numbers together."""
    return first_number * second_number


@tool
def get_word_length(word: str) -> int:
    """Returns the length of a word."""
    return len(word)


tools = [get_word_length]

# Get the prompt to use - you can modify this!
prompt = hub.pull("hwchase17/openai-functions-agent")

# Choose the LLM that will drive the agent
llm = AzureChatOpenAI(
    azure_endpoint="https://xxx.openai.azure.com/",
    api_version="2023-12-01-preview",
    model="gpt-35-turbo-0613"
)

# Construct the OpenAI Functions agent
agent_runnable = create_openai_functions_agent(llm, tools, prompt)


class AgentState(TypedDict):
    # The input string
    input: str
    # The list of previous messages in the conversation
    chat_history: list[BaseMessage]
    # The outcome of a given call to the agent 给定调用的输出
    # Needs `None` as a valid type, since this is what this will start as
    agent_outcome: Union[AgentAction, AgentFinish, None]
    # List of actions and corresponding observations
    # Here we annotate this with `operator.add` to indicate that operations to
    # this state should be ADDED to the existing values (not overwrite it)
    intermediate_steps: Annotated[list[tuple[AgentAction, str]], operator.add]


# This a helper class we have that is useful for running tools
# It takes in an agent action and calls that tool and returns the result
tool_executor = ToolExecutor(tools)


# Define the agent
def run_agent(data):
    agent_outcome = agent_runnable.invoke(data)
    return {"agent_outcome": agent_outcome}


# Define the function to execute tools
def execute_tools(data):
    # Get the most recent agent_outcome - this is the key added in the `agent` above
    agent_action = data["agent_outcome"]
    output = tool_executor.invoke(agent_action)
    return {"intermediate_steps": [(agent_action, str(output))]}


# Define logic that will be used to determine which conditional edge to go down
def should_continue(data):
    # If the agent outcome is an AgentFinish, then we return `exit` string
    # This will be used when setting up the graph to define the flow
    if isinstance(data["agent_outcome"], AgentFinish):
        return "end"
    # Otherwise, an AgentAction is returned
    # Here we return `continue` string
    # This will be used when setting up the graph to define the flow
    else:
        return "continue"


# Define a new graph
workflow = StateGraph(AgentState)

# Define the two nodes we will cycle between
workflow.add_node("agent", run_agent)
workflow.add_node("action", execute_tools)

# Set the entrypoint as `agent`
# This means that this node is the first one called
workflow.set_entry_point("agent")

# We now add a conditional edge
workflow.add_conditional_edges(
    # First, we define the start node. We use `agent`.
    # This means these are the edges taken after the `agent` node is called.
    "agent",
    # Next, we pass in the function that will determine which node is called next.
    should_continue,
    # Finally we pass in a mapping.
    # The keys are strings, and the values are other nodes.
    # END is a special node marking that the graph should finish.
    # What will happen is we will call `should_continue`, and then the output of that
    # will be matched against the keys in this mapping.
    # Based on which one it matches, that node will then be called.
    {
        # If `tools`, then we call the tool node.
        "continue": "action",
        # Otherwise we finish.
        "end": END,
    },
)

# We now add a normal edge from `tools` to `agent`.
# This means that after `tools` is called, `agent` node is called next.
workflow.add_edge("action", "agent") # 建立双向边，构成环路

# Finally, we compile it!
# This compiles it into a LangChain Runnable,
# meaning you can use it as you would any other runnable
app = workflow.compile()

app.get_graph().print_ascii()
#                +-----------+
#                | __start__ |
#                +-----------+
#                       *
#                       *
#                       *
#                  +-------+
#                  | agent |
#                  +-------+*
#                ***         ***
#               *               *
#             **                 ***
# +-----------------+               *
# | should_continue |               *
# +-----------------+*              *
#           *         *****         *
#           *              ***      *
#           *                 ***   *
#     +---------+             +--------+
#     | __end__ |             | action |
#     +---------+             +--------+

inputs = {"input": "cal letters in the word educa and the word life, return the sum of letter", "chat_history": []}
for s in app.stream(inputs):
    print(list(s.values())[0])
    print("----")

# {'agent_outcome': AgentActionMessageLog(tool='get_word_length', tool_input={'word': 'educa'}, log="\nInvoking: `get_word_length` with `{'word': 'educa'}`\n\n\n", message_log=[AIMessage(content='', additional_kwargs={'function_call': {'arguments': '{\n  "word": "educa"\n}', 'name': 'get_word_length'}}, response_metadata={'token_usage': {'completion_tokens': 17, 'prompt_tokens': 80, 'total_tokens': 97}, 'model_name': 'gpt-35-turbo', 'system_fingerprint': None, 'finish_reason': 'function_call', 'logprobs': None}, id='run-30c23466-83f4-456d-bfa5-1d2e25821f0d-0')])}
# ----
# {'intermediate_steps': [(AgentActionMessageLog(tool='get_word_length', tool_input={'word': 'educa'}, log="\nInvoking: `get_word_length` with `{'word': 'educa'}`\n\n\n", message_log=[AIMessage(content='', additional_kwargs={'function_call': {'arguments': '{\n  "word": "educa"\n}', 'name': 'get_word_length'}}, response_metadata={'token_usage': {'completion_tokens': 17, 'prompt_tokens': 80, 'total_tokens': 97}, 'model_name': 'gpt-35-turbo', 'system_fingerprint': None, 'finish_reason': 'function_call', 'logprobs': None}, id='run-30c23466-83f4-456d-bfa5-1d2e25821f0d-0')]), '5')]}
# ----
# {'agent_outcome': AgentActionMessageLog(tool='get_word_length', tool_input={'word': 'life'}, log="\nInvoking: `get_word_length` with `{'word': 'life'}`\n\n\n", message_log=[AIMessage(content='', additional_kwargs={'function_call': {'arguments': '{\n  "word": "life"\n}', 'name': 'get_word_length'}}, response_metadata={'token_usage': {'completion_tokens': 16, 'prompt_tokens': 107, 'total_tokens': 123}, 'model_name': 'gpt-35-turbo', 'system_fingerprint': None, 'finish_reason': 'function_call', 'logprobs': None}, id='run-4dbabc25-56c8-406b-b03b-8f404e777f59-0')])}
# ----
# {'intermediate_steps': [(AgentActionMessageLog(tool='get_word_length', tool_input={'word': 'life'}, log="\nInvoking: `get_word_length` with `{'word': 'life'}`\n\n\n", message_log=[AIMessage(content='', additional_kwargs={'function_call': {'arguments': '{\n  "word": "life"\n}', 'name': 'get_word_length'}}, response_metadata={'token_usage': {'completion_tokens': 16, 'prompt_tokens': 107, 'total_tokens': 123}, 'model_name': 'gpt-35-turbo', 'system_fingerprint': None, 'finish_reason': 'function_call', 'logprobs': None}, id='run-4dbabc25-56c8-406b-b03b-8f404e777f59-0')]), '4')]}
# ----
# {'agent_outcome': AgentFinish(return_values={'output': 'The word "educa" has 5 letters and the word "life" has 4 letters. The sum of the letters is 5 + 4 = 9.'}, log='The word "educa" has 5 letters and the word "life" has 4 letters. The sum of the letters is 5 + 4 = 9.')}
# ----
```

#### multi-Agent

## 总结

本文简单介绍了 langgraph，通过例子展示了 langgraph 灵活的Agent构建方案。其中，背后的设计逻辑也很值得学习。后续我将会逐步拆解源码的实现，以及pregel和beam的作用

## 参考

1. [面向大规模图计算的系统优化](https://www.birentech.com/Research_nstitute_details/18087820.html)
2. [Pregel（图计算）技术原理](https://cshihong.github.io/2018/05/30/Pregel%EF%BC%88%E5%9B%BE%E8%AE%A1%E7%AE%97%EF%BC%89%E6%8A%80%E6%9C%AF%E5%8E%9F%E7%90%86/)
3. [DPA Bulk Synchronous Prallel](https://web.cse.msstate.edu/~luke/Courses/fl15/CSE4163/Slides/DPA_BSP.pdf)
4. [langgraph](https://python.langchain.com/docs/langgraph/#documentation)
5. [What's next for AI agentic workflows ft. Andrew Ng of AI Fund](https://www.youtube.com/watch?v=sal78ACtGTc)