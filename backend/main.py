import os
import json
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Swarm Debugger API")

# Enable CORS so your React frontend can communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = genai.Client()

class CodeRequest(BaseModel):
    code: str

@app.post("/debug/stream")
async def swarm_debug_stream(request: CodeRequest):
    async def event_generator():
        original_code = request.code
        model_name = 'gemini-2.5-flash'
        config = types.GenerateContentConfig(max_output_tokens=300)
        
        try:
            # 1. PROSECUTOR AGENT
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Prosecutor is analyzing the code...'})}\n\n"
            prosecutor_prompt = (
                "You are the Prosecutor Agent. Your audience is a beginner who has never seen this code.\n"
                "Find bugs in the Python code and explain in simple, everyday English without unexplained jargon.\n"
                "Say exactly WHERE the code fails (name the line or part) and WHY it fails.\n"
                "Include one tiny real example input that triggers the failure (e.g., 'If the list is empty, this line crashes because...').\n"
                "Describe your fix in plain words. You may show at most the single relevant line (max 2-3 lines) of code showing the fix; do not dump full code listings. The rest must be plain sentences.\n"
                "Keep your answer under 120 words, concise, easy to scan, and maximum 5-6 short sentences or bullet points.\n\n"
                f"Code:\n{original_code}"
            )
            
            prosecutor_output = ""
            response = await client.aio.models.generate_content_stream(
                model=model_name, contents=prosecutor_prompt, config=config
            )
            async for chunk in response:
                text = chunk.text or ""
                if not text:
                    continue
                prosecutor_output += text
                yield f"data: {json.dumps({'agent': 'prosecutor', 'text': text})}\n\n"

            # DELAY BEFORE DEFENDER
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Defender is getting ready...'})}\n\n"
            await asyncio.sleep(2.5)

            # 2. DEFENDER AGENT
            defender_prompt = (
                "You are the Defender Agent. Your audience is a beginner who has never seen this code.\n"
                "Respond directly to the Prosecutor's specific points and challenge their logic on the same code.\n"
                "Find edge cases where their fix or reasoning breaks down. Explain WHERE and WHY in simple, everyday English without unexplained jargon.\n"
                "Include one tiny real example input that triggers the failure.\n"
                "Describe your superior fix in plain words. You may show at most the single relevant line (max 2-3 lines) of code showing your fix; do not dump full code listings. The rest must be plain sentences.\n"
                "Keep your answer under 120 words, concise, easy to scan, and maximum 5-6 short sentences or bullet points.\n\n"
                f"Original Code:\n{original_code}\n\n"
                f"Prosecutor's Fix:\n{prosecutor_output}"
            )
            
            defender_output = ""
            response = await client.aio.models.generate_content_stream(
                model=model_name, contents=defender_prompt, config=config
            )
            async for chunk in response:
                text = chunk.text or ""
                if not text:
                    continue
                defender_output += text
                yield f"data: {json.dumps({'agent': 'defender', 'text': text})}\n\n"

            # DELAY BEFORE JUDGE
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Judge is evaluating both sides...'})}\n\n"
            await asyncio.sleep(3.5)

            # 3. JUDGE AGENT
            judge_prompt = (
                "You are the Judge Agent. Your audience is a beginner who has never seen this code.\n"
                "Evaluate both sides based on the Prosecutor's and Defender's actual suggested fixes. Use simple, everyday English without jargon.\n"
                "Write 4-5 short edge-case test cases in plain English (e.g. 'Empty input', 'Negative number', 'Very large value'), one line each.\n"
                "For each test case, state whether the Prosecutor's fixed code PASSES or FAILS, and whether the Defender's fixed code PASSES or FAILS.\n"
                "End with a clear scorecard in this exact format:\n"
                "Prosecutor's code passed: X/Y test cases\n"
                "Defender's code passed: X/Y test cases\n"
                "Winner: <Prosecutor / Defender / Tie> - one plain sentence explaining why.\n\n"
                "Keep the whole Judge response under 150 words.\n\n"
                f"Original Code Intent:\n{original_code}\n\n"
                f"Prosecutor:\n{prosecutor_output}\n\n"
                f"Defender:\n{defender_output}"
            )
            
            judge_output = ""
            response = await client.aio.models.generate_content_stream(
                model=model_name, contents=judge_prompt, config=config
            )
            async for chunk in response:
                text = chunk.text or ""
                if not text:
                    continue
                judge_output += text
                yield f"data: {json.dumps({'agent': 'judge', 'text': text})}\n\n"

            # FINISHED
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Done'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'agent': 'error', 'text': str(e)})}\n\n"

    # Returns the continuous text/event-stream response
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disables proxy buffering on hosting platforms like Render
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)