"""Fixed OpenAI tutor transport, no redirects/tools/retries; only used after explicit key selection."""
import httpx
from ..contracts import LLMResult
from .. import ledger
from ..models import OPENAI_TUTOR
# Official source: https://developers.openai.com/api/docs/models/gpt-4o-mini.md
RATES=(0.15,0.60)  # USD per million input/output tokens, checked 2026-10-25

async def generate(db,*,key,prompt,system,venture_id,run_id):
    async with httpx.AsyncClient(timeout=45,follow_redirects=False,trust_env=False) as client:
        response=await client.post('https://api.openai.com/v1/chat/completions',headers={'Authorization':'Bearer '+key.get_secret_value()},json={'model':OPENAI_TUTOR,'messages':[{'role':'system','content':system},{'role':'user','content':prompt}],'max_tokens':512,'stream':False})
    if response.status_code!=200: raise ValueError('OpenAI tutor request failed')
    data=response.json();usage=data.get('usage',{})
    tokens_in=usage.get('prompt_tokens');tokens_out=usage.get('completion_tokens')
    if not isinstance(tokens_in,int) or not isinstance(tokens_out,int) or min(tokens_in,tokens_out)<0: raise ValueError('OpenAI usage missing')
    actual_model=data.get('model')
    if not isinstance(actual_model,str) or not actual_model.startswith(OPENAI_TUTOR): raise ValueError('Unexpected tutor model')
    cost=(tokens_in*RATES[0]+tokens_out*RATES[1])/1_000_000
    async with db.tx() as tx:
        await ledger.record(tx,venture_id=venture_id,run_id=run_id,department_id='engineering',agent_id='eng.builder',kind='model',model=actual_model,cost_usd=cost,units_in=tokens_in,units_out=tokens_out,estimated=False)
        await tx.execute('UPDATE runs SET tokens_in=?,tokens_out=?,cost_usd=?,model=? WHERE id=?',(tokens_in,tokens_out,cost,actual_model,run_id))
    return LLMResult(text=data['choices'][0]['message']['content'],interaction_id=None,model=actual_model,tokens_in=tokens_in,tokens_out=tokens_out,cost_usd=cost,estimated_cost=False)
