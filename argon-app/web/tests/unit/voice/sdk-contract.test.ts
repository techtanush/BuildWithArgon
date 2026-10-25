import { expect, it } from 'vitest';
import type { PartialOptions } from '@elevenlabs/client';
// Exercise the installed SDK serializer, not a local mock of its wire contract.
import { constructOverrides } from '../../../node_modules/@elevenlabs/client/dist/utils/overrides.js';
import { sdkVoiceOverrides } from '../../../src/world/conversation/VoiceCall';
import { voiceForAuthoredAsset } from '../../../src/world/conversation/voiceProfile';
import type { VoiceSessionInfo } from '../../../src/shared/contracts';
const info: VoiceSessionInfo = { session_id:'contract',provider:'elevenlabs',connection:'webrtc',conversation_token:'test-only',signed_url:null,expires_at:null,reason:null,
  overrides:{prompt:'Only verified company sources',first_message:'Hello',voice_id:'catalog-voice'},dynamic_variables:{venture_id:'v'} };
it('maps typed SDK overrides to the real v1.26 snake-case wire payload',()=>{
  const options = { conversationToken:'test-only',connectionType:'webrtc',textOnly:false,
    overrides:sdkVoiceOverrides(info),dynamicVariables:info.dynamic_variables } satisfies PartialOptions;
  const wire=constructOverrides(options);
  expect(wire).toMatchObject({type:'conversation_initiation_client_data',conversation_config_override:{
    agent:{prompt:{prompt:'Only verified company sources'},first_message:'Hello'},tts:{voice_id:'catalog-voice'},
  },dynamic_variables:{venture_id:'v'}});
  expect(options).not.toHaveProperty('conversationConfigOverride');
  expect(wire.conversation_config_override?.tts).not.toHaveProperty('voiceId');
});
it('uses actual authored licensed body metadata, never NPC names or face guesses',()=>{
  for(const assetId of ['microsoft-rocketbox/Female_Adult_01-jaw','microsoft-rocketbox/Female_Adult_02-active','microsoft-rocketbox/Male_Adult_01-active']) {
    const profile=voiceForAuthoredAsset(assetId)!;
    expect(profile.useCase).toBe('conversational');
    expect(sdkVoiceOverrides(info,assetId)?.tts).toEqual({voiceId:profile.voiceId});
  }
  expect(voiceForAuthoredAsset('Nova')).toBeUndefined();expect(voiceForAuthoredAsset('female-looking-face')).toBeUndefined();
  expect(voiceForAuthoredAsset('__proto__')).toBeUndefined();
  expect(sdkVoiceOverrides(info,'unknown')?.tts).toEqual({voiceId:'catalog-voice'});
});
it('never sends forbidden model, expressiveness, stability or speed overrides',()=>{
  const tts=sdkVoiceOverrides(info,'microsoft-rocketbox/Female_Adult_01-jaw')?.tts;
  expect(Object.keys(tts!)).toEqual(['voiceId']);
});
