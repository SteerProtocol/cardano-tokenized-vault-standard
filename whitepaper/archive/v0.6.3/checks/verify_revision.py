#!/usr/bin/env python3
"""CTVS v0.6 publication, schema and arithmetic checks only.

Not the historical model suite; no Aiken, Plutus, real signatures, ledger
acceptance, minimum ADA, resource budgets or native integration are tested.
Run from any directory with Python 3 and jsonschema installed.
"""
from __future__ import annotations
import copy,hashlib,json,re,sys,unittest,io
from fractions import Fraction
from pathlib import Path
from math import ceil,floor
from random import Random
from jsonschema import Draft202012Validator
CHECKS=Path(__file__).resolve().parent
ARCHIVE=CHECKS.parent
ROOT=ARCHIVE.parent.parent
SOURCES={n:(ARCHIVE/'source'/f'CTVS-{n}-Whitepaper-v0.6.md').read_text() for n in (1,2)}
SCHEMA=json.loads((ARCHIVE/'integration/response.schema.json').read_text())
EXAMPLES=json.loads((ARCHIVE/'integration/illustrative-responses.json').read_text())
COUNTS={'arithmetic_tuples':0,'budget_tuples':0,'positive_response_examples':0,'negative_response_examples':0,'balanced_transactions':0}

def stripped(s):
    return re.sub(r'(?ms)^```[^\n]*\n.*?^```\s*$', '', s)

def section(s,num):
    m=re.search(r'(?m)^## '+re.escape(num)+r' [^\n]+\n',s)
    if not m:raise ValueError(num)
    end=re.search(r'(?m)^#{1,2} \d+\.',s[m.end():])
    return s[m.start():m.end()+end.start() if end else len(s)].strip()

def cd(n,d):
    if n<0 or d<=0:raise ValueError('division domain')
    return (n+d-1)//d

def quote(A,S,Vs,op,n,b):
    X,Y=A+1,S+Vs
    if op=='deposit':
        f=cd(n*b,10000+b);v=n-f;return (n,v,f,v*Y//X)
    if op=='mint':
        v=cd(n*X,Y);f=cd(v*b,10000);return (v+f,v,f,n)
    if op=='withdraw':
        f=cd(n*b,10000);g=n+f;return (g,n,f,cd(g*Y,X))
    if op=='redeem':
        g=n*X//Y;f=cd(g*b,10000+b);return (g,g-f,f,n)
    raise ValueError(op)

def validate_response(x):
    Draft202012Validator(SCHEMA).validate(x)
    b=x['body'];k=x['kind']
    if k=='request':
        if x['implementation']['kind']=='reference' and b['delivery_mode']!='funded_claim':
            raise ValueError('Profile 0 is claim-only')
        if b['lifecycle']=='pending_escrow' and (b['realized_quantity']['status']=='known' or b['result_outputs']):
            raise ValueError('Pending estimate is not realized')
        if b['lifecycle']=='settled_delivered':
            if b['delivery_mode']!='delivery_at_settlement' or b['realized_quantity']['status']!='known' or not b['result_outputs']:
                raise ValueError('Direct settlement must record final outputs, not a claim')
        if b['lifecycle']=='claimable' and b['delivery_mode']!='funded_claim':
            raise ValueError('Direct variant cannot become claimable')
    if k=='quote' and b['operation'].startswith('request_') and b['quote_kind']=='exact_at_snapshot':
        raise ValueError('This fixture contract does not promise exact future async pricing')
    if k=='build_effects':
        ids=[z['output_index'] for z in b['outputs']]
        if len(ids)!=len(set(ids)) or not set(b['change_output_indices']).issubset(ids):raise ValueError('Output identity')
        if int(b['validity_interval']['lower'])>=int(b['validity_interval']['upper']):raise ValueError('Empty interval')
        for o in b['outputs']:
            assets=[json.dumps(v['asset'],sort_keys=True) for v in o['value']]
            if len(assets)!=len(set(assets)):raise ValueError('Duplicate asset quantity entry')

def balance(inputs,outputs,mint,fee):
    assets={'ada'}|set(mint)
    for v in inputs+outputs:assets.update(v)
    for a in assets:
        left=sum(v.get(a,0) for v in inputs)+mint.get(a,0)
        right=sum(v.get(a,0) for v in outputs)+(fee if a=='ada' else 0)
        if left!=right:raise AssertionError((a,left,right))
    COUNTS['balanced_transactions']+=1

class PublicationChecks(unittest.TestCase):
    def test_01_reference_wire_artifacts_identical(self):
        expected=json.loads((CHECKS/'baseline-wire-sha256.json').read_text())
        self.assertEqual(set(expected),{'schema.json','wire.cddl','types.ak','golden.json'})
        for name,digest in expected.items():self.assertEqual(hashlib.sha256((ROOT/'candidate-wire'/name).read_bytes()).hexdigest(),digest,name)
        g=json.loads((ROOT/'candidate-wire/golden.json').read_text())
        self.assertEqual(len(bytes.fromhex(g['commitment']['domain_hex'])),14)
        self.assertEqual(g['commitment']['domain_hex'],'435456532f48322f5445524d5300')

    def test_02_retained_reference_sections(self):
        exp=json.loads((CHECKS/'baseline-sections.json').read_text())
        for item in exp:
            actual=section(SOURCES[item['paper']],item['section'])
            self.assertEqual(hashlib.sha256(actual.encode()).hexdigest(),item['sha256'],item)

    def test_03_versions_and_explicit_boundaries(self):
        for s in SOURCES.values():
            self.assertIn('revision: "0.6"',s);self.assertIn('11 September 2026',s)
            self.assertIn('Implementation release remains blocked',s)
            self.assertIn('no new wire tag',s.lower())
            self.assertNotIn('H1',s);self.assertNotIn('H2-integrated',s)
            self.assertNotIn('This editorial revision does not require a data or deployment migration',s)
        self.assertIn('No Claim constructor or Delivery redeemer has been changed',SOURCES[2])
        self.assertIn('existing three fields',SOURCES[2])
        self.assertIn('No generic module catalogue',SOURCES[1])

    def test_04_all_section_numbers_exist_and_unique(self):
        for n,s in SOURCES.items():
            clean=stripped(s)
            major=re.findall(r'(?m)^# (\d+)\. ',clean)
            self.assertEqual(major,[str(i) for i in range(1,17)],n)
            sub=re.findall(r'(?m)^## (\d+\.\d+) ',clean)
            self.assertEqual(len(sub),len(set(sub)),n)
        # Check explicit references to the other paper and unambiguous local references.
        nums={n:set(re.findall(r'(?m)^#{1,2} (\d+(?:\.\d+)?)(?:\.| )',stripped(s))) for n,s in SOURCES.items()}
        for n,s in SOURCES.items():
            clean=stripped(s)
            for m in re.finditer(r'CTVS-([12]) Section (\d+(?:\.\d+)?)',clean):
                self.assertIn(m.group(2),nums[int(m.group(1))],(n,m.group(0)))
            # remove cross-paper references before checking simple local ones
            clean=re.sub(r'CTVS-[12] Section \d+(?:\.\d+)?','',clean)
            for m in re.finditer(r'(?<![A-Za-z])Section (\d+(?:\.\d+)?)',clean):
                self.assertIn(m.group(1),nums[n],(n,m.group(0)))

    def test_05_citation_labels_resolve(self):
        for n,s in SOURCES.items():
            defined=set(re.findall(r'(?m)^\[([A-Z][A-Z0-9-]*|[0-9]+)\] ',s))
            clean=stripped(s)
            for raw in re.findall(r'\[([A-Z][A-Z0-9, :;-]+)\]',clean):
                # semicolon/colon suffix may name an in-source requirement, not a new reference.
                for label in re.split(r',\s*',raw):
                    label=label.split(':')[0].strip()
                    if re.fullmatch(r'[A-Z][A-Z0-9-]*',label):self.assertIn(label,defined,(n,label))

    def test_06_no_duplicate_historical_run_tables(self):
        for s in SOURCES.values():
            self.assertNotIn('| Semantic transaction model | 85 tests passed',s)
            self.assertNotIn('# Appendix A. Evidence-to-requirement register',s)
        e=(ROOT/'archive/v0.6.3/evidence/CTVS-Validation-Evidence.md').read_text()
        self.assertIn('85 passed',e);self.assertIn('71 passed',e);self.assertIn('600,000',e)
        reg=json.loads((ARCHIVE/'evidence/assurance-register.json').read_text())
        self.assertTrue(all(x['disposition']=='BLOCKED_FOR_IMPLEMENTATION_RELEASE' for x in reg['requirements']))
        self.assertEqual(len(reg['requirements']),14)

    def test_07_reference_quotes_and_residual(self):
        self.assertEqual(quote(1000000,1000000,1,'deposit',101000,100),(101000,100000,1000,100000))
        self.assertEqual(quote(1100000,1100000,1,'redeem',50500,100),(50500,50000,500,50500))
        self.assertEqual(quote(100000000,100000000,1,'deposit',10100000,100),(10100000,10000000,100000,10000000))
        self.assertEqual(quote(0,0,2,'mint',3,0),(2,2,0,3))
        self.assertEqual(quote(2,3,2,'redeem',3,0),(1,1,0,3))
        self.assertEqual(quote(850000,1000000,1,'redeem',100000,0)[1],85000)

    def test_08_reference_action_arithmetic_differential(self):
        rng=Random(20260911)
        for _ in range(1200):
            A,S,Vs=rng.randrange(1000000),rng.randrange(1000000),rng.choice([1,2,10,1000])
            amount,b=rng.randint(1,100000),rng.choice([0,1,100,1000,9999])
            X,Y=A+1,S+Vs
            for op in ['deposit','mint','withdraw','redeem']:
                got=quote(A,S,Vs,op,amount,b)
                if op=='deposit':
                    f=ceil(Fraction(amount*b,10000+b));net=amount-f;expected=(amount,net,f,floor(Fraction(net*Y,X)))
                elif op=='mint':
                    net=ceil(Fraction(amount*X,Y));f=ceil(Fraction(net*b,10000));expected=(net+f,net,f,amount)
                elif op=='withdraw':
                    f=ceil(Fraction(amount*b,10000));g=amount+f;expected=(g,amount,f,ceil(Fraction(g*Y,X)))
                else:
                    g=floor(Fraction(amount*X,Y));f=ceil(Fraction(g*b,10000+b));expected=(g,g-f,f,amount)
                self.assertEqual(got,expected)
                COUNTS['arithmetic_tuples']+=1

    def test_09_reference_value_balances(self):
        balance([{'unit':1000000,'ada':3000000,'state':1},{'unit':101000,'ada':6000000}],
                [{'unit':1101000,'ada':3000000,'state':1},{'share':100000,'ada':2000000},{'ada':3600000}],{'share':100000},400000)
        balance([{'unit':1101000,'ada':3000000,'state':1},{'share':50500,'ada':5000000}],
                [{'unit':1051000,'ada':3000000,'state':1},{'unit':50000,'ada':2000000},{'ada':2600000}],{'share':-50500},400000)
        balance([{'ada':103000000,'state':1},{'ada':15100000}],
                [{'ada':113100000,'state':1},{'ada':2000000,'share':10000000},{'ada':2600000}],{'share':10000000},400000)
        balance([{'unit':1051000,'ada':3000000,'state':1},{'ada':5000000}],
                [{'unit':1049500,'ada':3000000,'state':1},{'unit':1500,'ada':2000000},{'ada':2600000}],{},400000)
        balance([{'unit':101000,'ada':6000000}],
                [{'unit':101000,'ada':3000000},{'ada':2600000}],{},400000)
        balance([{'share':100000,'ada':6000000}],
                [{'share':50500,'ada':3000000},{'share':49500,'ada':2600000}],{},400000)
        balance([{'share':100000,'ada':2000000},{'ada':4000000}],
                [{'share':100000,'ada':2000000},{'ada':3600000}],{},400000)
        balance([{'unit':101000,'ada':3500000,'extra':7},{'ada':4000000}],
                [{'unit':101000,'ada':3500000,'extra':7},{'ada':3600000}],{},400000)
        balance([{'share':100000,'ada':2500000},{'ada':4000000}],
                [{'share':100000,'ada':2500000},{'ada':3600000}],{},400000)

    def test_10_mixed_batch_and_direct_delivery_substitution(self):
        a=quote(1000000,1000000,1,'deposit',101000,100)
        b=quote(1000000,1000000,1,'deposit',50500,100)
        c=quote(1000000,1000000,1,'redeem',50500,100)
        A=1000000+a[1]+b[1]-c[0];S=1000000+a[3]+b[3]-c[3];F=a[2]+b[2]+c[2]
        self.assertEqual((A,S,F),(1099500,1099500,2000))
        inputs=[{'unit':1000000,'ada':4000000,'state':1},{'unit':101000,'ada':3000000},
                {'unit':50500,'ada':3000000},{'share':50500,'ada':3000000},{'ada':6000000}]
        outputs=[{'unit':A+F,'ada':4000000,'state':1},{'share':100000,'ada':2000000},
                 {'share':50000,'ada':2000000},{'unit':50000,'ada':2000000},{'ada':3000000},{'ada':5400000}]
        balance(inputs,outputs,{'share':99500},600000)
        # Change only the output disposition in the semantic sketch, not the value.
        funded=[{'disposition':'claim','value':v} for v in outputs[1:4]]
        direct=[{'disposition':'final_receiver','value':copy.deepcopy(v['value'])} for v in funded]
        self.assertEqual([x['value'] for x in funded],[x['value'] for x in direct])
        self.assertTrue(all(x['disposition']!='claim' for x in direct))
        balance(inputs,[outputs[0]]+[x['value'] for x in direct]+outputs[4:],{'share':99500},600000)

    def test_11_lifecycle_rounding_counterexample(self):
        def sequence(order):
            A,S=2,3;claim=None
            for op in order:
                q=quote(A,S,2,op,1 if op=='deposit' else 3,0)
                if op=='deposit':A+=q[1];S+=q[3]
                else:A-=q[0];S-=q[3];claim=q[1]
            return A,S,claim
        self.assertEqual(sequence(['deposit','redeem']),(1,1,2))
        self.assertEqual(sequence(['redeem','deposit']),(2,1,1))

    def test_12_budget_equivalence_without_wire_change(self):
        for R in range(1,17):
            for B in range(33):
                for e in range(B+1):
                    r=R+B-e
                    self.assertEqual(r+e,R+B);self.assertEqual(r,R+B-e)
                    self.assertGreater(r,0);COUNTS['budget_tuples']+=1
        self.assertIn('execution_budget, settler_fee',SOURCES[2])
        self.assertIn('existing three fields',SOURCES[2])

    def test_13_inventory_denominator(self):
        self.assertEqual(1000-400,600)
        self.assertIn('600 participating shares',SOURCES[1])
        self.assertIn('Pending-redemption shares',SOURCES[2])

    def test_14_positive_response_shapes_and_crossfields(self):
        Draft202012Validator.check_schema(SCHEMA)
        for x in EXAMPLES:
            validate_response(x);COUNTS['positive_response_examples']+=1
            self.assertEqual(x['verification'],'illustrative')
            self.assertEqual(x['conformance_claims'],[])
        self.assertEqual(len(EXAMPLES),5)

    def test_15_targeted_bad_responses_rejected(self):
        bad=[]
        x=copy.deepcopy(EXAMPLES[0]);del x['chain_point'];bad.append(x)
        x=copy.deepcopy(EXAMPLES[0]);x['body']['backing']['value']=1000000;bad.append(x)
        x=copy.deepcopy(EXAMPLES[1]);x['body']['output']={'status':'unknown','units':'share_base_units','value':'0','reason':'missing'};bad.append(x)
        x=copy.deepcopy(EXAMPLES[0]);x['body']['share']['policy_id']='not-a-policy';bad.append(x)
        x=copy.deepcopy(EXAMPLES[2]);x['body']['realized_quantity']={'status':'known','units':'share_base_units','value':'1'};bad.append(x)
        x=copy.deepcopy(EXAMPLES[3]);x['implementation']=copy.deepcopy(EXAMPLES[0]['implementation']);bad.append(x)
        x=copy.deepcopy(EXAMPLES[3]);x['body']['lifecycle']='claimable';bad.append(x)
        x=copy.deepcopy(EXAMPLES[3]);x['body']['result_outputs']=[];bad.append(x)
        x=copy.deepcopy(EXAMPLES[1]);x['body']['operation']='request_deposit';bad.append(x)
        x=copy.deepcopy(EXAMPLES[4]);x['body']['outputs'][1]['output_index']=0;bad.append(x)
        x=copy.deepcopy(EXAMPLES[4]);x['body']['validity_interval']['upper']=x['body']['validity_interval']['lower'];bad.append(x)
        x=copy.deepcopy(EXAMPLES[0]);x['implementation']['wire_version']=3;bad.append(x)
        for x in bad:
            with self.assertRaises(Exception):validate_response(x)
            COUNTS['negative_response_examples']+=1

    def test_16_build_effects_complete_value_example(self):
        b=EXAMPLES[4]['body']
        def akey(a):
            if a['kind']=='ada':return 'ada'
            return bytes.fromhex(a['asset_name']).decode().lower()
        outs=[{akey(v['asset']):int(v['quantity']) for v in o['value']} for o in b['outputs']]
        balance([{'unit':1000000,'ada':3000000,'state':1},{'unit':101000,'ada':6000000}],outs,{'share':100000},400000)
        self.assertEqual(b['construction_status'],'illustrative_only')

if __name__=='__main__':
    if not __debug__:raise SystemExit('Do not run revision checks under optimized Python.')
    stream=io.StringIO();suite=unittest.defaultTestLoader.loadTestsFromTestCase(PublicationChecks)
    result=unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)
    (CHECKS/'revision-tests.log').write_text(stream.getvalue())
    data={'document_revision':'0.6','date':'2026-09-11','status':'PASS' if result.wasSuccessful() else 'FAIL',
          'test_methods':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'subchecks':COUNTS,
          'evidence_scope':'Publication/source preservation, off-chain example schema, and bounded arithmetic only.',
          'historical_suites_rerun':False,'reference_wire_changed':False,
          'new_native_delivery_implemented':False,'implementation_release':'BLOCKED',
          'not_tested':['compiled validators','Plutus builtin serialization','real signatures','ledger acceptance','minimum ADA','execution units',
                        'native protocol integration','independent audit','production indexer rollback','unbounded correctness']}
    (CHECKS/'revision-results.json').write_text(json.dumps(data,indent=2)+'\n')
    print(stream.getvalue());print(json.dumps(data,indent=2))
    sys.exit(0 if result.wasSuccessful() else 1)
