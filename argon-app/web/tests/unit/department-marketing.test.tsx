import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {marketingActive, marketingMetadata, marketingPdf, DepartmentGroupChat} from '../../src/world/hud/DepartmentGroupChat';
import {MessageBody} from '../../src/world/hud/WorkplacePanel';
describe('Growth research workspace', () => {
  it('accepts only venture-owned hashed PDF downloads', () => {
    const uri = `/v1/ventures/owned/marketing/${'a'.repeat(64)}.pdf`;
    expect(marketingPdf(uri,'owned')).toBe(uri);
    for (const value of [uri+'?x=1',uri.replace('owned','other'),'https://evil.test'+uri,'/v1/ventures/owned/marketing/demo.pdf']) expect(marketingPdf(value,'owned')).toBeNull();
  });
  it('uses actual safe metadata and active ticket statuses', () => {
    expect(marketingMetadata({id:'a',title:'a',uri:null,meta_json:'{"sources":["https://example.com"]}'}).sources).toEqual(['https://example.com']);
    expect(marketingMetadata({id:'a',title:'a',uri:null,meta_json:'invalid'})).toEqual({});
    for(const status of ['open','in_progress','waiting_approval','blocked','approved']) expect(marketingActive({tasks:[{id:'t',title:'t',status}],artifacts:[]})).toBe(true);
    expect(marketingActive({tasks:[{id:'t',title:'t',status:'done'}],artifacts:[]})).toBe(false);
  });
  it('escapes text and links only actual agent https sources', () => {
    const html=renderToStaticMarkup(<MessageBody body={'<script>alert(1)</script> https://example.com/report. javascript:alert(1)'} source={{authorId:'real',authorKind:'agent'}}/>);
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('href="https://example.com/report"'); expect(html).toContain('rel="noopener noreferrer"'); expect(html).not.toContain('<script>'); expect(html).not.toContain('href="javascript:');
  });
  it('never pins Engineering preview in Growth and renders explicit cost disclosure', () => {
    const html=renderToStaticMarkup(<DepartmentGroupChat ventureId="owned" departmentId="growth" name="Marketing" mock={false} activity={null} activityError={null} onClose={()=>{}}/>);
    expect(html).toContain('Market research'); expect(html).toContain('$0.25'); expect(html).toContain('Research market'); expect(html).not.toContain('Open built app'); expect(html).not.toContain('Build status:');
  });
});
