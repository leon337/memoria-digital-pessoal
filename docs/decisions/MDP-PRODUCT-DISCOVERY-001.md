# MDP-PRODUCT-DISCOVERY-001

## Mission

`MDP-001 — Memória Digital Pessoal`

## Status

Product Discovery Q1–Q16: COMPLETE.

## Decisions

### Q1 — Product definition
Integrated personal digital memory covering routine, events, people and memories.

### Q2 — Primary user
Only the mother is the product user in the MVP. A family dashboard is not an MVP requirement.

### Q3 — Input model
Hybrid input with voice as primary modality; photos, camera, text and selective automation as support.

### Q4 — Client platform
Web PWA, smartphone-first and usable on tablet/computer.

### Q5 — Offline behavior
Partial offline-first: essential recording and consultation work offline, with later synchronization.

### Q6 — Organization
AI may organize automatically while preserving explicit categories, timeline and relationships.

### Q7 — Anti-fabrication policy
Strict anti-fabricated-memory behavior. Epistemic states include confirmed, probable/inferred, conflicting and unknown. Inference never becomes fact merely because a model produced it.

### Q8 — Automatic capture
Selective, consented automatic capture. No blanket surveillance.

### Q9 — Consultation
Multimodal consultation through voice, text, search and visual/timeline/category navigation.

### Q10 — Proactivity
Controlled and contextual proactivity. The system may help spontaneously when justified but should avoid unnecessary interruption.

### Q11 — Storage direction
Local storage plus encrypted cloud synchronization and backup.

### Q12 — Autobiographical scope
Complete autobiographical memory is supported, but emotions are treated as facts only when explicitly stated, not inferred.

### Q13 — Reconstruction
Evidence-based reconstruction with provenance. The system distinguishes confirmed, inferred and unknown and must support explaining why it is making a claim.

### Q14 — Corrections
Full history plus explicit correction and provenance. Corrections do not silently erase prior records.

### Q15 — Memory-use patterns
The system may monitor objective usage patterns such as repeated questions, reminder needs and correction frequency, but it must not diagnose dementia, Alzheimer’s disease or another medical condition.

### Q16 — Risk-proportional safety
High-risk questions require stronger evidence. When evidence is insufficient, the system must say it cannot confirm rather than fabricate certainty.

## MVP principles

- Single elderly user.
- Voice-first, low cognitive load and accessible controls.
- Strong provenance and anti-hallucination rules.
- Very sensitive personal data: encryption, consent, minimization, deletion, backup and access control are mandatory design concerns.
- MVP must prove: input → save → organize → later query → trustworthy answer → uncertainty/source disclosure.

## Deferred beyond initial MVP

- face recognition;
- broad ambient monitoring;
- smartwatch integration;
- medical diagnostic platform;
- family dashboard;
- full home assistant;
- advanced behavioral analytics;
- fully local large AI models.

## Open product constraint

The mother is the sole product user, but account/key/data recovery must remain possible if credentials are forgotten or the device is lost, without turning relatives into default product users.
