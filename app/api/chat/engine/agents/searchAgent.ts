import {FunctionTool, OpenAIAgent, QueryEngineTool} from "llamaindex";
import {
    createPageInNotion,
    signJwt
} from "@/app/utility/request-utilities";
import {getDataSource} from "@/app/api/chat/engine";
import {generateFilters} from "@/app/api/chat/engine/queryFilter";

export async function createSearchAgent(userId: string | (() => string), documentIds?: string[], params?: any): Promise<OpenAIAgent>{

    const createNotionPage = FunctionTool.from(
        async({ title, text }: { title: string; text: string; }) => {
            console.log("Notion Page Title: " + title);
            console.log("Page text: " + text. replace(/(\r\n|\n|\r)/gm," "));

            const response = await createPageInNotion({title: title, text: text}, signJwt(userId));
            if(response.status){
                return "Notion page successfully created";
            }
            return "Notion page failed to be created";
        },
        {
            name: "createNotionPage",
            description: "Use this function to create a page in Notion. When users ask for text or document contents to " +
                "be sent to Notion, use this function tool",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "Title of Notion Page",
                    },
                    text: {
                        type: "string",
                        description: "Text contents of the Notion page",
                    },
                },
                required: ["title", "text"],
            },
        }
    );

    const index = await getDataSource(params);
    const permissionFilters = generateFilters(documentIds || []);
    const queryEngine = index.asQueryEngine({
        similarityTopK: process.env.TOP_K ? parseInt(process.env.TOP_K) : 3,
        preFilters: permissionFilters,
    });

    const queryEngineTool = new QueryEngineTool({
        queryEngine: queryEngine,
        metadata: {
            description: "query engine to pinecone database",
            name: "queryEngineTool"
        }
    });

    return new OpenAIAgent({
        tools: [
            createNotionPage,
            queryEngineTool]
    });
}