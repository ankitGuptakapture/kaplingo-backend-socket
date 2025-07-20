import 'dotenv/config';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function translateText(inputText:string) {
  try{
    const response:any = await openai.chat.completions.create({
        model: 'gpt-4', // or gpt-3.5-turbo
        messages: [
          {
            role: 'system',
            content: 'You are a translation assistant. Translate input to English.',
          },
          {
            role: 'user',
            content: `Translate this to English: ${inputText}`,
          },
        ],
    });
      return response.choices[0].message.content.trim();
  }catch(err){
    throw err;
  }
  
}

export default translateText;

