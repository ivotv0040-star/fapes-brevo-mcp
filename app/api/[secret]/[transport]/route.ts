import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SENDER_NAME = process.env.SENDER_NAME || "Grupo FAPES";
const SENDER_EMAIL = process.env.SENDER_EMAIL || "marketing@grupofapes.com.br";

function parseRecipients(value: string | undefined) {
  const defaultRecipients =
    "marketing@grupofapes.com.br,ivo.coelho@grupofapes.com.br";

  return (value || defaultRecipients)
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({
      email,
      name: email
    }));
}

const TO_RECIPIENTS = parseRecipients(process.env.TO_RECIPIENTS);

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }

  return value;
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const mcpPathSecret = process.env.MCP_PATH_SECRET || "missing-secret";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "enviar_email_html_brevo",
      {
        title: "Enviar e-mail HTML via Brevo",
        description:
          "Envia um e-mail HTML de teste via Brevo. O remetente e o destinatário são fixos em marketing@grupofapes.com.br. Use somente depois de confirmação explícita do usuário.",
        inputSchema: {
          subject: z
            .string()
            .min(3)
            .max(180)
            .describe("Assunto do e-mail."),
          htmlContent: z
            .string()
            .min(20)
            .max(100000)
            .describe("HTML completo do corpo do e-mail."),
          textContent: z
            .string()
            .max(5000)
            .optional()
            .describe("Versão em texto puro opcional do e-mail.")
        },
        outputSchema: {
          ok: z.boolean(),
          messageId: z.string().optional(),
          from: z.string(),
          to: z.string(),
          subject: z.string()
        }
      },
      async ({ subject, htmlContent, textContent }) => {
        const BREVO_API_KEY = getRequiredEnv("BREVO_API_KEY");

        const fallbackText =
          textContent ||
          stripHtml(htmlContent).slice(0, 4000) ||
          "Este e-mail possui conteúdo HTML.";

        const brevoPayload = {
  sender: {
    name: SENDER_NAME,
    email: SENDER_EMAIL
  },
  to: TO_RECIPIENTS,
  replyTo: {
    email: SENDER_EMAIL,
    name: SENDER_NAME
  },
  subject,
  htmlContent,
  textContent: fallbackText
};

        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "api-key": BREVO_API_KEY
          },
          body: JSON.stringify(brevoPayload)
        });

        const responseText = await response.text();

        let responseJson: any = {};
        try {
          responseJson = JSON.parse(responseText);
        } catch {
          responseJson = {};
        }

        if (!response.ok) {
          throw new Error(
            `Erro Brevo ${response.status}: ${responseText || response.statusText}`
          );
        }

        const result = {
  ok: true,
  messageId: responseJson.messageId || "",
  from: SENDER_EMAIL,
  to: TO_RECIPIENTS.map((recipient) => recipient.email).join(", "),
  subject
};

        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: `E-mail HTML enviado com sucesso para ${result.to}. Message ID: ${
  result.messageId || "não informado"
}`
            }
          ]
        };
      }
    );
  },
  {},
  {
    basePath: `/api/${mcpPathSecret}`,
    maxDuration: 60,
    verboseLogs: true
  }
);

async function secureRoute(request: Request, context: any) {
  const secret = process.env.MCP_PATH_SECRET;

  if (!secret) {
    return new Response("MCP_PATH_SECRET não configurado.", {
      status: 500
    });
  }

  const params = context?.params || {};
  const receivedSecret =
    typeof params.then === "function"
      ? (await params).secret
      : params.secret;

  if (receivedSecret !== secret) {
    return new Response("Not found", {
      status: 404
    });
  }

  return handler(request);
}

export { secureRoute as GET, secureRoute as POST };
