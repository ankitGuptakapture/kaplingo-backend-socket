import 'dotenv/config';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function translateText(inputText: string) {
  try {
    const response: any = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are a professional multilingual translator. Your job is to accurately translate any input text into clear, grammatically correct English. 
Ignore filler words, repetitions, false starts, or interruptions.
If the sentence is incomplete, infer and complete it sensibly.
Keep the original intent, tone, and meaning.`,
        },
        {
          role: 'user',
          content: `Translate the following to English: ${inputText}`,
        },
      ],
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    throw err;
  }
}


export default translateText;