// deno run --allow-net --allow-env --env-file --allow-write --allow-read --watch mod.ts
import { Hono } from "npm:hono";
import { serveStatic } from "npm:hono/deno";
import { randomUUID } from "node:crypto";

import { callOllama } from "./llm.ts";

import { agents as projectAgents } from "./agents/project.ts";
import { agents as gddAgents } from "./agents/gdd.ts";
import { agents as architectAgents } from "./agents/architect.ts";
import { agents as feedbackAgents } from "./agents/feedback.ts";
import { agents as gameAgents } from "./agents/game.ts";
import { agents as genreAgents } from "./agents/genre.ts";
import { agents as nameAgents } from "./agents/name.ts";

const agents = [
  ...projectAgents,
  ...gddAgents,
  ...architectAgents,
  ...feedbackAgents,
  ...gameAgents,
  ...genreAgents,
  ...nameAgents,
];

export type Agent = {
  name: string;
  role: string;
  systemPrompt: string;
  facts: string[];
};

interface Context {
  [key: string]: any;
}

interface AgentOutput {
  message: string;
  contextUpdate?: Context;
}

interface Assistant {
  name: string;
  role: string;
  systemPrompt: string;
  memory: Context;
  ragContext?: string[];
  run: (
    input: string,
    shared: Context,
    sessionId: string,
  ) => Promise<AgentOutput>;
}

// --------------------------- Shared Context ---------------------------

const sharedContext: Context = {};

// --------------------------- Context Storage for Retry ---------------------------

type ContextStore = {
  [sessionId: string]: {
    sharedContext: Context;
    agentContexts: {
      [agentName: string]: {
        ragContext: string[];
        lastInput: string;
        lastOutput?: string;
      };
    };
  };
};

const contextStore: ContextStore = {};

// Save context function
async function saveContext(
  sessionId: string,
  agentName: string,
  input: string,
  ragContext: string[],
  output?: string,
  sharedContextParam?: Context,
) {
  if (!contextStore[sessionId]) {
    contextStore[sessionId] = {
      sharedContext: sharedContextParam || {},
      agentContexts: {},
    };
  }
  if (sharedContextParam) {
    contextStore[sessionId].sharedContext = sharedContextParam;
  }
  contextStore[sessionId].agentContexts[agentName] = {
    ragContext,
    lastInput: input,
    lastOutput: output,
  };

  await Deno.writeTextFile(
    `./output/shared.json`,
    JSON.stringify(contextStore),
  );
}

// Load context function
function loadContext(sessionId: string, agentName: string) {
  return contextStore[sessionId]?.agentContexts[agentName];
}

function retrieveDocs(
  agentName: string,
): string[] {
  return agents.find((agent) => agent.name === agentName)?.facts || [];
}

// --------------------------- Assistant Factory with Retry Support ---------------------------

function createAssistant(
  name: string,
  role: string,
  systemPrompt: string,
): Assistant {
  return {
    name,
    role,
    systemPrompt,
    memory: {},
    ragContext: [],
    async run(
      input: string,
      shared: Context,
      sessionId: string,
    ): Promise<AgentOutput> {
      try {
        // Try to load cached context for retry
        const previousContext = loadContext(sessionId, this.name);
        let ragDocs: string[];

        if (
          previousContext && previousContext.lastInput === input &&
          previousContext.ragContext.length > 0
        ) {
          ragDocs = previousContext.ragContext;
        } else {
          ragDocs = retrieveDocs(this.name);
        }

        this.ragContext = ragDocs;

        const rag = ragDocs.length
          ? ragDocs.join("\n\n")
          : "No relevant info found.";

        const prompt = `
You are ${this.role}.

System Instruction:
${this.systemPrompt}

User Input: ${input}

Retrieved Knowledge:
${rag}

Provide a clear, actionable response focused on the exact steps or process to achieve the result. Deliver fully polished, production-ready content without drafts or examples—directly show how it’s done.
`.trim();

        console.log(`\n[${this.name.toUpperCase()} INPUT]\n`, prompt.length);

        // const message = await callLLM(prompt); // uncomment to use ChatGPT
        const message = await callOllama(prompt);

        // Save context for retry and to persist shared context
        await saveContext(
          sessionId,
          this.name,
          input,
          ragDocs,
          message,
          shared,
        );

        const contextUpdate = { [`${this.name}_message`]: message };

        return { message, contextUpdate };
      } catch (err) {
        console.error(`[${this.name}] Error during run:`, err);
        // Return cached output if exists
        const previousContext = loadContext(sessionId, this.name);
        if (previousContext?.lastOutput) {
          return { message: previousContext.lastOutput, contextUpdate: {} };
        }
        throw err;
      }
    },
  };
}

// --------------------------- Assistants Setup ---------------------------

const assistants: Assistant[] = agents.map((agent) =>
  createAssistant(agent.name, agent.role, agent.systemPrompt)
);

// --------------------------- Coordinator ---------------------------

async function runAgentsSequentially(
  agents: Assistant[],
  input: string,
  shared: Context,
  sessionId: string,
) {
  const responses: string[] = [];
  for (const agent of agents) {
    console.log(agent.name);
    agent.ragContext = retrieveDocs(agent.name);
    const output = await agent.run(input, shared, sessionId);

    Object.assign(shared, output.contextUpdate || {});

    await Deno.writeTextFile(`./output/${agent.name}.md`, output.message);
    responses.push(output.message);
  }

  return responses;
}

async function main(
  userInput: string,
  sessionId: string,
  userAssistant: string,
) {
  try {
    const responses = await runAgentsSequentially(
      assistants.filter((assistant) => assistant.name === userAssistant),
      userInput,
      sharedContext,
      sessionId,
    );

    return responses;
  } catch (err) {
    console.error("Error during multi-agent run:", err);
    return [];
  }
}

function server() {
  const app = new Hono();

  app.use("/", serveStatic({ root: "./static/" }));

  app.get("/agents", (c: Context) => {
    const optionsHtml = agents
      .map((agent) => `<option value="${agent.name}">${agent.name}</option>`)
      .join("\n");

    return c.html(optionsHtml);
  });

  app.get("/backends", (c: Context) => {
    const optionsHtml = ["ollama", "chatgpt"]
      .map((backend) => `<option value="${backend}">${backend}</option>`)
      .join("\n");

    return c.html(optionsHtml);
  });

  app.post("/submit", async (c: Context) => {
    const body = await c.req.parseBody();
    const responses = await main(
      body.text,
      randomUUID(),
      body.agent,
    );

    return c.html(`<p>${responses?.join("\n")}</p>`);
  });

  app.onError((err: Error, c: Context) => {
    console.error("GLOBAL ERROR HANDLING: ", err.name);
    console.error(err.stack);

    return c.json({ message: err.message, success: false }, 500);
  });
  Deno.serve(
    {
      port: 8002,
      hostname: "0.0.0.0",
      onListen({ port, hostname }) {
        console.info(`Server started at http://${hostname}:${port}`);
      },
    },
    app.fetch,
  );

  Deno.addSignalListener("SIGINT", () => {
    console.log("Caught SIGINT. Cleaning up...");
    Deno.exit(0);
  });
}

server();
