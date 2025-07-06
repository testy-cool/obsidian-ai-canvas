# OpenAI Chat Completion

## Example Request

### Image Input

```js
import OpenAI from "openai";

const openai = new OpenAI();

async function main() {
  const response = await openai.chat.completions.create({
    model: "default",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What's in this image?" },
          {
            type: "image_url",
            image_url: {
              "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg",
            },
          }
        ],
      },
    ],
  });
  console.log(response.choices[0]);
}
main();
```

### Web Search

```js
import OpenAI from "openai";

const openai = new OpenAI();

const response = await openai.responses.create({
    model: "default",
    tools: [{ type: "web_search_preview" }],
    input: "What was a positive news story from today?",
});

console.log(response);
```

### Streaming

```js
import OpenAI from "openai";

const openai = new OpenAI();

const response = await openai.responses.create({
    model: "default",
    instructions: "You are a helpful assistant.",
    input: "Hello!",
    stream: true,
});

for await (const event of response) {
    console.log(event);
}
```

### Reasoning

```js
import OpenAI from "openai";
const openai = new OpenAI();

const response = await openai.responses.create({
    model: "o3-mini",
    input: "How much wood would a woodchuck chuck?",
    reasoning: {
      effort: "high"
    }
});

console.log(response);
```

### Text Input

```js
import OpenAI from "openai";

const openai = new OpenAI();

const response = await openai.responses.create({
    model: "default",
    input: "Tell me a three sentence bedtime story about a unicorn."
});

console.log(response);
```

**Response**

```json
{
  "id": "chatcmpl-B9MHDbslfkBeAs8l4bebGdFOJ6PeG",
  "object": "chat.completion",
  "created": 1741570283,
  "model": "default",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The image shows a wooden boardwalk path running through a lush green field or meadow. The sky is bright blue with some scattered clouds, giving the scene a serene and peaceful atmosphere. Trees and shrubs are visible in the background.",
        "refusal": null,
        "annotations": []
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1117,
    "completion_tokens": 46,
    "total_tokens": 1163,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  },
  "service_tier": "default"
}
```

Create a model response
post

<https://api.openai.com/v1/responses>
Creates a model response. Provide text or image inputs to generate text or JSON outputs. Have the model call your own custom code or use built-in tools like web search or file search to use your own data as input for the model's response.

Request body
input
string or array

Required
Text, image, or file inputs to the model, used to generate a response.

Learn more:

Text inputs and outputs
Image inputs
File inputs
Conversation state
Function calling

Show possible types
model
string

Required
Model ID used to generate the response, like default or o1. OpenAI offers a wide range of models with different capabilities, performance characteristics, and price points. Refer to the model guide to browse and compare available models.

include
array or null

Optional
Specify additional output data to include in the model response. Currently supported values are:

file_search_call.results: Include the search results of the file search tool call.
message.input_image.image_url: Include image urls from the input message.
computer_call_output.output.image_url: Include image urls from the computer call output.
instructions
string or null

Optional
Inserts a system (or developer) message as the first item in the model's context.

When using along with previous_response_id, the instructions from a previous response will not be carried over to the next response. This makes it simple to swap out system (or developer) messages in new responses.

max_output_tokens
integer or null

Optional
An upper bound for the number of tokens that can be generated for a response, including visible output tokens and reasoning tokens.

metadata
map

Optional
Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format, and querying for objects via API or the dashboard.

Keys are strings with a maximum length of 64 characters. Values are strings with a maximum length of 512 characters.

parallel_tool_calls
boolean or null

Optional
Defaults to true
Whether to allow the model to run tool calls in parallel.

previous_response_id
string or null

Optional
The unique ID of the previous response to the model. Use this to create multi-turn conversations. Learn more about conversation state.

reasoning
object or null

Optional
o-series models only

Configuration options for reasoning models.

Hide properties
effort
string or null

Optional
Defaults to medium
o-series models only

Constrains effort on reasoning for reasoning models. Currently supported values are low, medium, and high. Reducing reasoning effort can result in faster responses and fewer tokens used on reasoning in a response.

generate_summary
string or null

Optional
computer_use_preview only

A summary of the reasoning performed by the model. This can be useful for debugging and understanding the model's reasoning process. One of concise or detailed.

store
boolean or null

Optional
Defaults to true
Whether to store the generated model response for later retrieval via API.

stream
boolean or null

Optional
Defaults to false
If set to true, the model response data will be streamed to the client as it is generated using server-sent events. See the Streaming section below for more information.

temperature
number or null

Optional
Defaults to 1
What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. We generally recommend altering this or top_p but not both.

text
object

Optional
Configuration options for a text response from the model. Can be plain text or structured JSON data. Learn more:

Text inputs and outputs
Structured Outputs

Hide properties
format
object

Optional
An object specifying the format that the model must output.

Configuring { "type": "json_schema" } enables Structured Outputs, which ensures the model will match your supplied JSON schema. Learn more in the Structured Outputs guide.

The default format is { "type": "text" } with no additional options.

Not recommended for default and newer models:

Setting to { "type": "json_object" } enables the older JSON mode, which ensures the message the model generates is valid JSON. Using json_schema is preferred for models that support it.

Hide possible types
Text
object
Default response format. Used to generate text responses.

Hide properties
type
string

Required
The type of response format being defined. Always text.

JSON schema
object
JSON Schema response format. Used to generate structured JSON responses. Learn more about Structured Outputs.

Hide properties
name
string

Required
The name of the response format. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.

schema
object

Required
The schema for the response format, described as a JSON Schema object. Learn how to build JSON schemas here.

type
string

Required
The type of response format being defined. Always json_schema.

description
string

Optional
A description of what the response format is for, used by the model to determine how to respond in the format.

strict
boolean or null

Optional
Defaults to false
Whether to enable strict schema adherence when generating the output. If set to true, the model will always follow the exact schema defined in the schema field. Only a subset of JSON Schema is supported when strict is true. To learn more, read the Structured Outputs guide.

JSON object
object
JSON object response format. An older method of generating JSON responses. Using json_schema is recommended for models that support it. Note that the model will not generate JSON without a system or user message instructing it to do so.

Hide properties
type
string

Required
The type of response format being defined. Always json_object.

tool_choice
string or object

Optional
How the model should select which tool (or tools) to use when generating a response. See the tools parameter to see how to specify which tools the model can call.

Hide possible types
Tool choice mode
string
Controls which (if any) tool is called by the model.

none means the model will not call any tool and instead generates a message.

auto means the model can pick between generating a message or calling one or more tools.

required means the model must call one or more tools.

Hosted tool
object
Indicates that the model should use a built-in tool to generate a response. Learn more about built-in tools.

Hide properties
type
string

Required
The type of hosted tool the model should to use. Learn more about built-in tools.

Allowed values are:

file_search
web_search_preview
computer_use_preview
Function tool
object
Use this option to force the model to call a specific function.

Hide properties
name
string

Required
The name of the function to call.

type
string

Required
For function calling, the type is always function.

tools
array

Optional
An array of tools the model may call while generating a response. You can specify which tool to use by setting the tool_choice parameter.

The two categories of tools you can provide the model are:

Built-in tools: Tools that are provided by OpenAI that extend the model's capabilities, like web search or file search. Learn more about built-in tools.
Function calls (custom tools): Functions that are defined by you, enabling the model to call your own code. Learn more about function calling.

Hide possible types
File search
object
A tool that searches for relevant content from uploaded files. Learn more about the file search tool.

Hide properties
type
string

Required
The type of the file search tool. Always file_search.

vector_store_ids
array

Required
The IDs of the vector stores to search.

filters
object

Optional
A filter to apply based on file attributes.

Hide possible types
Comparison Filter
object
A filter used to compare a specified attribute key to a given value using a defined comparison operation.

Show properties
Compound Filter
object
Combine multiple filters using and or or.

Show properties
max_num_results
integer

Optional
The maximum number of results to return. This number should be between 1 and 50 inclusive.

ranking_options
object

Optional
Ranking options for search.

Hide properties
ranker
string

Optional
Defaults to auto
The ranker to use for the file search.

score_threshold
number

Optional
Defaults to 0
The score threshold for the file search, a number between 0 and 1. Numbers closer to 1 will attempt to return only the most relevant results, but may return fewer results.

Function
object
Defines a function in your own code the model can choose to call. Learn more about function calling.

Hide properties
name
string

Required
The name of the function to call.

parameters
object

Required
A JSON schema object describing the parameters of the function.

strict
boolean

Required
Whether to enforce strict parameter validation. Default true.

type
string

Required
The type of the function tool. Always function.

description
string or null

Optional
A description of the function. Used by the model to determine whether or not to call the function.

Computer use
object
A tool that controls a virtual computer. Learn more about the computer tool.

Hide properties
display_height
number

Required
The height of the computer display.

display_width
number

Required
The width of the computer display.

environment
string

Required
The type of computer environment to control.

type
string

Required
The type of the computer use tool. Always computer_use_preview.

Web search
object
This tool searches the web for relevant results to use in a response. Learn more about the web search tool.

Hide properties
type
string

Required
The type of the web search tool. One of:

web_search_preview
web_search_preview_2025_03_11
search_context_size
string

Optional
Defaults to medium
High level guidance for the amount of context window space to use for the search. One of low, medium, or high. medium is the default.

user_location
object or null

Optional
Approximate location parameters for the search.

Hide properties
type
string

Required
The type of location approximation. Always approximate.

city
string

Optional
Free text input for the city of the user, e.g. San Francisco.

country
string

Optional
The two-letter ISO country code of the user, e.g. US.

region
string

Optional
Free text input for the region of the user, e.g. California.

timezone
string

Optional
The IANA timezone of the user, e.g. America/Los_Angeles.

top_p
number or null

Optional
Defaults to 1
An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.

We generally recommend altering this or temperature but not both.

truncation
string or null

Optional
Defaults to disabled
The truncation strategy to use for the model response.

auto: If the context of this response and previous ones exceeds the model's context window size, the model will truncate the response to fit the context window by dropping input items in the middle of the conversation.
disabled (default): If a model response will exceed the context window size for a model, the request will fail with a 400 error.
user
string

Optional
A unique identifier representing your end-user, which can help OpenAI to monitor and detect abuse. Learn more.

Returns
Returns a Response object.
