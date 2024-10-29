import {FunctionTool, OpenAIAgent, QueryEngineTool} from "llamaindex";
import {
    attachSalesforceTask, createGoogleCalendarEvent,  getGoogleCalendarAvailability,
    sendSlack,
    signJwt
} from "@/app/utility/request-utilities";
import {getDataSource} from "@/app/api/chat/engine";
import {generateFilters} from "@/app/api/chat/engine/queryFilter";

export async function createSdrAgent(userId: string | (() => string), documentIds?: string[], params?: any): Promise<OpenAIAgent>{
    const getSdrSchedule = FunctionTool.from(
        async ({ dummy }: {dummy: string}) => {
            console.log("Getting SDR Calendar");
            const response = await getGoogleCalendarAvailability(signJwt(userId));
            console.log(response);
            if (response.busy) {
                return response.busy;
            }
            return "Calendar could not be pulled";
        },
        {
            name: "getSdrSchedule",
            description: "Use this function when a user asks to schedule a meeting with the SDR. This function returns when " +
                "the SDR is busy and UNABLE to meet." +
                "Times are provided in UTC format. Use the convertUtcDatetimeToPstDatetime tool to convert UTC datetimes to" +
                "PST before returning results.",
            parameters: {
                type: "object",
                properties: {
                    dummy: {
                        type: "string",
                        description: "dummy",
                    },
                },
                required: [],
            },
        },
    );

    const convertUtcDatetimeToPstDatetime = FunctionTool.from(
        ({datetime}: {datetime: string}) => {
            console.log("Converting UTC time");
            console.log(new Date(new Date(datetime).toString()));
            return JSON.stringify({pstDatetime: new Date(datetime).toString()});
        },
        {
            name: "convertUtcDatetimeToPstDatetime",
            description:
                "Use this function to convert UTC datetimes to PST. Use this function whenever UTC datetimes are given such as" +
                " after the getSdrSchedule function tool is used.",
            parameters: {
                type: "object",
                properties: {
                    datetime: {
                        type: "string",
                        description: "datetime in UTC",
                    },
                },
                required: ["datetime"],
            },
        },
    );

    const createMeeting = FunctionTool.from(
        async ({ datetime, email }: {datetime: string, email: string}) => {
            console.log("Creating Calendar Event");
            console.log("Time: " + datetime);
            console.log("attendee email: " + email);
            const response = await createGoogleCalendarEvent({event_name: "SDR Intro Call", attendees: email, start_time: datetime}, signJwt(userId));
            console.log(response);
            if (response.status) {
                return "Meeting created successfully";
            }
            return "Meeting failed to be created";
        },
        {
            name: "createMeeting",
            description:
                "Use this function to schedule a meeting with the user. Prompt user for their email so we know where to" +
                "send the invite to. Meetings will be one hour.",
            parameters: {
                type: "object",
                properties: {
                    datetime: {
                        type: "string",
                        description: "datetime of meeting in west coast time (pacific time)",
                    },
                    email: {
                        type: "string",
                        description: "The email of the attendee",
                    },
                },
                required: ["datetime", "email"],
            },
        },
    );

    const sendSlackMeetingNotification = FunctionTool.from(
        async ({ datetime, email }: {datetime: string, email: string}) => {
            console.log("Slack Meeting Notification");
            console.log("Time: " + datetime);
            console.log("attendee email: " + email);
            const message = "Meeting scheduled for " + new Date(datetime).toString() + " with " + email;
            const response = await sendSlack(message, signJwt(userId));
            console.log(response);
            if (response.status) {
                return "Slack meeting notification created successfully";
            }
            return "Slack meeting notification failed to be created";
        },
        {
            name: "sendSlackMeetingNotification",
            description:
                "Use this function after a meeting has been created with the createMeeting tool. Create a Salesforce Task " +
                "using the createSalesforceTask if not done yet.",
            parameters: {
                type: "object",
                properties: {
                    datetime: {
                        type: "string",
                        description: "datetime of meeting",
                    },
                    email: {
                        type: "string",
                        description: "The email of the attendee",
                    },
                },
                required: ["datetime", "email"],
            },
        },
    );

    const createSalesforceTask = FunctionTool.from(
        async ({ datetime, email }: {datetime: string, email: string}) => {
            console.log("Salesforce Task");
            console.log("Time: " + datetime);
            console.log("attendee email: " + email);
            const response = await attachSalesforceTask({email: email, meeting_time: new Date(datetime).toISOString().split('T')[0]}, signJwt(userId));
            console.log(response);
            if (response.status) {
                return "Salesforce Task created successfully";
            }
            return "Salesforce Task failed to be created";
        },
        {
            name: "createSalesforceTask",
            description:
                "Use this function after a meeting has been created with the createMeeting tool to create a " +
                "Salesforce Task when a meeting has been scheduled with the SDR",
            parameters: {
                type: "object",
                properties: {
                    datetime: {
                        type: "string",
                        description: "datetime of meeting",
                    },
                    email: {
                        type: "string",
                        description: "The email of the attendee",
                    },
                },
                required: ["datetime", "email"],
            },
        },
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
            getSdrSchedule, convertUtcDatetimeToPstDatetime,
            createMeeting, sendSlackMeetingNotification, createSalesforceTask,
            queryEngineTool]
    });
}