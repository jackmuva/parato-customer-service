import {FunctionTool, OpenAIAgent, QueryEngineTool} from "llamaindex";
import {getDataSource} from "@/app/api/chat/engine";
import {generateFilters} from "@/app/api/chat/engine/queryFilter";
import {
    createAccountTaskInSalesforce,
    createTicketInIntercom,
    signJwt
} from "@/app/utility/request-utilities";

export async function createCustomerServiceAgent(userId: string | (() => string), documentIds?: string[], params?: any): Promise<OpenAIAgent>{

    const createIntercomTicket = FunctionTool.from(
        async({ issue, title }: { issue: string; title: string;}) => {
            console.log("Intercom ticket title:");
            console.log(title);
            console.log("Intercom issue:");
            console.log(issue);

            if(typeof userId === "string") {
                const response = await createTicketInIntercom({email: userId, issue: issue, title: title}, signJwt(userId));
                if (response.status) {
                    return "Intercom Ticket successfully created";
                }
            }
            return "Intercom Ticket failed to be created";
        },
        {
            name: "createIntercomTicket",
            description: "Use this function to create an Intercom Ticket when user asks for escalation. Make sure " +
                "to prompt user for their company name if not provided. Create an Account " +
                "Task in Salesforce with the createSalesforceAccountTask tool if not already done.",
            parameters: {
                type: "object",
                properties: {
                    issue: {
                        type: "string",
                        description: "summary of the Intercom ticket",
                    },
                    title: {
                        type: "string",
                        description: "title of the Intercom ticket",
                    }
                },
                required: ["issue", "title"],
            },
        }
    );

    const createSalesforceAccountTask = FunctionTool.from(
        async({ account, transcript, subject }: { account: string; transcript: string; subject: string}) => {
            console.log("Salesforce Account:");
            console.log(account);
            console.log("Salesforce Task Subject:");
            console.log(subject);
            console.log("Chat transcript:");
            console.log(transcript);

            const response = await createAccountTaskInSalesforce({account: account, transcript: transcript, subject: subject}, signJwt(userId));
            if (response.status) {
                return "Salesforce Account Task successfully created";
            }
            return "Salesforce Account Task failed to be created";
        },
        {
            name: "createSalesforceAccountTask",
            description: "Use this function to create an Account Task in Salesforce when user asks for escalation. Make sure " +
                "to prompt user for their company name if not provided. Create an intercom ticket with the createIntercomTicket tool " +
                "as well if not done already",
            parameters: {
                type: "object",
                properties: {
                    account: {
                        type: "string",
                        description: "Company name of the user",
                    },
                    transcript: {
                        type: "string",
                        description: "Entire transcript of the chat",
                    },
                    subject: {
                        type: "string",
                        description: "Title of the Intercom ticket",
                    }
                },
                required: ["account", "transcript", "subject"],
            },
        }
    );

    const index = await getDataSource(params);
    const permissionFilters = generateFilters(documentIds || []);
    const queryEngine = index.asQueryEngine({
        similarityTopK: process.env.TOP_K ? parseInt(process.env.TOP_K) : 3,
        // preFilters: permissionFilters,
    });

    const queryEngineTool = new QueryEngineTool({
        queryEngine: queryEngine,
        metadata: {
            description: "Provides information on Paragon specific topics and issues",
            name: "queryEngineTool"
        }
    });

    return new OpenAIAgent({
        tools: [createIntercomTicket, createSalesforceAccountTask, queryEngineTool]
    });
}