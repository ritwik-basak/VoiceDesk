import asyncio
import sys
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import os
import re
from datetime import datetime
from typing import Annotated, TypedDict
import operator

from langchain_groq import ChatGroq
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from app.agent.agents import (
    create_booking_agent,
    create_receptionist_agent,
    create_summary_agent,
)

# ------------------------------------------------------------------
# Langfuse tracing
# ------------------------------------------------------------------

os.environ["LANGFUSE_PUBLIC_KEY"]  = os.getenv("LANGFUSE_PUBLIC_KEY", "")
os.environ["LANGFUSE_SECRET_KEY"]  = os.getenv("LANGFUSE_SECRET_KEY", "")
os.environ["LANGFUSE_HOST"]        = os.getenv("LANGFUSE_BASE_URL", "https://jp.cloud.langfuse.com")

from langfuse.langchain import CallbackHandler as LangfuseCallbackHandler
langfuse_handler = LangfuseCallbackHandler()

# ------------------------------------------------------------------
# LLM
# ------------------------------------------------------------------

llm = ChatGroq(
    model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
    api_key=os.getenv("GROQ_API_KEY"),
    max_retries=3,
)

# ------------------------------------------------------------------
# Agent instances
# ------------------------------------------------------------------

receptionist_agent = create_receptionist_agent(llm)
booking_agent = create_booking_agent(llm)
summary_agent = create_summary_agent(llm)

# ------------------------------------------------------------------
# State definition
# ------------------------------------------------------------------


class ConversationState(TypedDict):
    messages: Annotated[list[BaseMessage], operator.add]
    phone_number: str
    user_name: str
    current_intent: str
    conversation_stage: str
    cost_usd: float
    tokens_used: int
    started_at: str
    appointments_made: list[dict]
    next_agent: str


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _extract_usage(messages: list[BaseMessage]) -> tuple[int, int]:
    """Sum input/output tokens from all AI messages in the list."""
    input_tokens = output_tokens = 0
    for msg in messages:
        if isinstance(msg, AIMessage) and msg.usage_metadata:
            input_tokens += msg.usage_metadata.get("input_tokens", 0)
            output_tokens += msg.usage_metadata.get("output_tokens", 0)
    return input_tokens, output_tokens


def _parse_intent(text: str) -> str | None:
    """Extract 'INTENT: <value>' from the end of an agent response."""
    match = re.search(r"INTENT:\s*(\w+)", text, re.IGNORECASE)
    return match.group(1).lower() if match else None


def _last_ai_content(messages: list[BaseMessage]) -> str:
    """Return the string content of the most recent AIMessage."""
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            return msg.content if isinstance(msg.content, str) else ""
    return ""


# ------------------------------------------------------------------
# Nodes
# ------------------------------------------------------------------


def supervisor_node(state: ConversationState) -> ConversationState:
    """Pure Python router — no LLM call. Keeps latency low and routing deterministic."""
    stage = state.get("conversation_stage", "GREETING")
    intent = state.get("current_intent", "")
    phone = state.get("phone_number", "")

    if stage == "GREETING" or not phone:
        next_agent = "receptionist"
    elif stage == "IDENTIFIED" and intent == "":
        next_agent = "receptionist"
    elif intent in ("book", "retrieve", "cancel", "modify", "list_doctors"):
        next_agent = "booking"
    elif intent == "end":
        next_agent = "summary"
    else:
        next_agent = "receptionist"

    return {**state, "next_agent": next_agent}


async def receptionist_node(state: ConversationState) -> ConversationState:
    try:
        receptionist = create_receptionist_agent(llm)
        messages = state["messages"]

        result = await receptionist.ainvoke({"messages": messages})

        response_text = ""
        for msg in result["messages"]:
            if hasattr(msg, "content") and msg.content:
                response_text = msg.content

        # Parse INTENT from response
        intent = ""
        if "INTENT:" in response_text:
            intent_line = [line for line in response_text.split("\n") if "INTENT:" in line]
            if intent_line:
                intent = intent_line[-1].replace("INTENT:", "").strip().lower()

        # Extract phone number if present
        phone = state.get("phone_number", "")

        # Update token tracking
        tokens_used = state.get("tokens_used", 0) + 100
        cost = state.get("cost_usd", 0.0)

        new_messages = list(messages) + [AIMessage(content=response_text)]

        return {
            **state,
            "messages": new_messages,
            "current_intent": intent if intent else state.get("current_intent", ""),
            "conversation_stage": "IDENTIFIED" if phone else state.get("conversation_stage", "GREETING"),
            "tokens_used": tokens_used,
            "cost_usd": cost,
            "next_agent": "",
        }
    except Exception:
        import traceback
        traceback.print_exc()
        return {
            **state,
            "messages": list(state["messages"]) + [AIMessage(content="I apologize, I encountered an error. Please try again.")],
            "next_agent": "",
        }


async def booking_node(state: ConversationState) -> ConversationState:
    try:
        booking = create_booking_agent(llm)
        messages = state["messages"]

        result = await booking.ainvoke({"messages": messages})

        response_text = ""
        for msg in result["messages"]:
            if hasattr(msg, "content") and msg.content:
                response_text = msg.content

        # Check if user wants to end
        intent = state.get("current_intent", "")
        if "INTENT: end" in response_text:
            intent = "end"

        new_messages = list(messages) + [AIMessage(content=response_text)]

        return {
            **state,
            "messages": new_messages,
            "current_intent": intent,
            "tokens_used": state.get("tokens_used", 0) + 100,
        }
    except Exception:
        import traceback
        traceback.print_exc()
        return {
            **state,
            "messages": list(state["messages"]) + [AIMessage(content="I apologize, I encountered an error.")],
            "current_intent": "end",
        }


async def summary_node(state: ConversationState) -> dict:
    """Run the summary agent to close the conversation and persist the record."""
    result = await summary_agent.ainvoke(
        {"messages": state["messages"]},
    )

    new_messages: list[BaseMessage] = result["messages"][len(state["messages"]):]
    input_tokens, output_tokens = _extract_usage(new_messages)

    final_tokens = state["tokens_used"] + input_tokens + output_tokens
    final_cost = (
        state["cost_usd"]
        + (input_tokens * 0.0000008)
        + (output_tokens * 0.000004)
    )

    return {
        "messages": new_messages,
        "tokens_used": final_tokens,
        "cost_usd": final_cost,
        "conversation_stage": "END",
    }


# ------------------------------------------------------------------
# Conditional edge functions
# ------------------------------------------------------------------


def route_after_supervisor(state: ConversationState) -> str:
    agent = state.get("next_agent", "receptionist")
    if agent == "booking":
        return "booking_node"
    if agent == "summary":
        return "summary_node"
    return "receptionist_node"


def route_after_agent(state: ConversationState) -> str:
    intent = state.get("current_intent", "")
    messages = state.get("messages", [])

    if intent == "end":
        return "summary_node"

    # After booking node runs once, go to END to return response
    # Frontend will send next message to continue
    if len(messages) > 4:
        return END

    if intent in ["book", "retrieve", "cancel", "modify", "list_doctors"]:
        return "booking_node"

    return END


# ------------------------------------------------------------------
# Graph definition (compiled inside create_graph with checkpointer)
# ------------------------------------------------------------------

workflow = StateGraph(ConversationState)

workflow.add_node("supervisor_node", supervisor_node)
workflow.add_node("receptionist_node", receptionist_node)
workflow.add_node("booking_node", booking_node)
workflow.add_node("summary_node", summary_node)

workflow.add_edge(START, "supervisor_node")
workflow.add_conditional_edges("supervisor_node", route_after_supervisor)
workflow.add_conditional_edges("receptionist_node", route_after_agent)
workflow.add_conditional_edges("booking_node", route_after_agent)
workflow.add_edge("summary_node", END)


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------


async def create_graph(db_url: str):
    """Compile the workflow with PostgreSQL checkpointer for persistent state."""
    try:
        # Add SSL mode to connection string
        if "sslmode" not in db_url:
            db_url = db_url + "?sslmode=require"

        # Use connection pool instead of single connection
        from psycopg_pool import AsyncConnectionPool

        pool = AsyncConnectionPool(
            conninfo=db_url,
            max_size=2,
            min_size=1,
            open=False,
            kwargs={
                "autocommit": True,
                "prepare_threshold": 0,
            },
        )

        await asyncio.wait_for(pool.open(), timeout=10.0)

        checkpointer = AsyncPostgresSaver(pool)
        await checkpointer.setup()

        compiled = workflow.compile(checkpointer=checkpointer)
        print("VoiceDesk using PostgreSQL checkpointer")
        return compiled

    except Exception as e:
        print(f"PostgreSQL checkpointer failed: {e}")
        print("Falling back to in-memory checkpointer")
        from langgraph.checkpoint.memory import MemorySaver
        checkpointer = MemorySaver()
        compiled = workflow.compile(checkpointer=checkpointer)
        print("VoiceDesk using in-memory checkpointer")
        return compiled


async def run_conversation_turn(
    graph,
    thread_id: str,
    user_message: str,
    initial_state: dict = None,
) -> dict:
    """Execute one conversation turn, restoring prior state via the checkpointer."""
    config = {
        "configurable": {"thread_id": thread_id},
        "callbacks": [langfuse_handler],
    }

    if initial_state is not None:
        result = await graph.ainvoke(initial_state, config)
    else:
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content=user_message)]},
            config,
        )

    return result
