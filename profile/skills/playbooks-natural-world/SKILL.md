---
name: playbooks-natural-world
description: How the method bends for the life sciences (botany, mycology, ecology), the earth sciences and geography — deep time, scales and rates, identification and its uncertainty, taxonomy as a moving target, and the safety rules around fungi. Load for any living-world, geological, or geographical subject.
whenToUse: When teaching or planning botany, mycology, ecology, evolutionary biology, geology, earth systems, physical or human geography, or anything about the natural world in the field.
---

# Natural-world playbooks

These subjects have real laws, which makes the foundations easier than in the humanities — and two traps of their own: **scale** (the numbers are outside human intuition, so the learner's intuition silently substitutes something wrong) and **naming** (names look like facts and are conventions that keep changing).

## The life sciences

**The unconditional truth of the whole domain is that living things are related by descent**, and everything else is downstream of it: why homologies exist, why classification is a tree, why species have the traits they do, why there is no "higher" and "lower". Teach that as the root and most of biology becomes derivable rather than a list of organisms. Its corollary, equally load-bearing: **variation is the raw material, selection is the sorting, and neither has a goal.**

Then the reusable structure: the levels of organisation (molecule → cell → tissue → organism → population → ecosystem → biosphere) and what each level makes visible that the one below cannot; the flow of energy (one-way, from the sun, degrading at each step) against the cycling of matter (round and round) — this contrast is one of the cleanest unconditional truths in biology and explains a startling amount; homeostasis and its feedback loops; and the difference between a population's *growth* and its *regulation*.

**Phylogeny is a tool, not decoration.** Teach him to read a cladogram: nodes are common ancestors, branch length is not "progress", and a group is only real if it includes all descendants of its ancestor. Once he can read one, taxonomy stops being rote and becomes an argument about evidence. Fungi are closer to animals than to plants — that single correction of a folk category is worth teaching explicitly, because it reorganises a lot of assumptions.

**Identification is a determination with a confidence, never a fact.** The right question is not "what is this?" but "what characters put it here, and what else has those characters?" Teach the diagnostic characters, then the lookalikes, then the key. This is where the method's check questions shine: hand him a specimen description and ask which couplet it runs to, and where the key would fail.

### Safety — mycology (not negotiable)

Fungi are the one subject where a teaching error can kill him.

- **Never present an identification as safe to eat.** Give the determination, the diagnostic characters, the confidence, and the dangerous lookalikes — always.
- The classic confusions are the ones to teach explicitly and early: the *Amanita* species that carry amatoxins against edible agarics and puffballs; the death cap and destroying angel against straw mushrooms and *Agaricus*; *Galerina* against *Psilocybe* and against honey mushrooms; *Omphalotus* against chanterelles; *Gyromitra* against morels. Each of these has a *character* that separates them — spore colour, gill attachment, volva, habitat, season — and the character is the teaching, not the verdict.
- Teach that "it looks like the picture" is not identification, that a spore print and habitat are evidence, and that a false morel can be deadly. When unsure, the answer is: do not eat it.
- Teach him to *learn* identification rather than *ask for* it: keys, characters, spore prints, habitat, season, and a local foray or society. The learning is the point and it is also the safety.

### Botany

- **Family characters first**: the recurring combinations (Apiaceae's umbels and sheathing petioles, Brassicaceae's four petals and six stamens, Lamiaceae's square stems and opposite leaves, Fabaceae's pea flowers) give him a handle that works on plants he has never seen. Families are the highest-leverage nodes in the whole subject.
- **Install the vocabulary as tools, not terms**: leaf arrangement, margin, venation, attachment; inflorescence types; floral formulae. Then check by having him *describe* a plant he can see, precisely enough that you could draw it.
- **Phenology is the layer that makes it real**: what is out, when, in his own region. Tied to his own walks, this is the subject's engine — a plant learned in the field stays; a plant learned from a list does not.
- **The trap**: teaching plants as a gallery of names. A name with no diagnostic characters is a fact that rots. Name → characters → lookalikes → where it grows, every time.

### Ecology

Energy flow and nutrient cycling are the roots; then trophic levels and why they are short; then succession; then the two ideas that reorganise everything — that populations are regulated by density-dependent and density-independent forces, and that "balance of nature" is a story rather than a finding (disturbance is normal, and communities are contingent). Expect the myths: the pristine wilderness, the wolf-as-hero, the tidy food chain.

## The earth sciences

**The foundation is deep time plus uniformitarianism-as-a-method**: the same physical processes we can watch, acting over spans he cannot feel. Those two together make almost everything else derivable, and they are exactly what intuition refuses — which is why the first job is to break the intuition with a scale he can feel (a year on a metre of tape; a human lifetime as a hair's width of the column).

Then the reusable structural truths, in dependency order:

1. **The rock cycle and the three rock types** as a cycle of processes, not a classification of samples.
2. **Plate tectonics** as the unifying theory: the boundary types and what each produces (new crust, destroyed crust, sliding crust), which explains mountain belts, earthquakes, volcanoes, ocean basins and the shape of continents from one mechanism. Fold mineral and rock identification into it rather than teaching them separately.
3. **Stratigraphic principles** — superposition, original horizontality, cross-cutting relationships, inclusions, faunal succession — which are the discipline's version of logic: from them, a sequence of events is *derivable*. This is the best place in the whole subject for "how could I have discovered this?".
4. **Rates and their methods**: radiometric dating, its error bars, what each isotope is good for, and the difference between a measurement and a model output. Never give a date without the method behind it.

**Geography is the bridge and deserves its own treatment.** Physical geography is earth science at human scale — landforms, drainage, climate, soils, biomes — and it is the layer where he will use the science on walks. Human geography is the other half: population, settlement, resources, and the fact that **space and place are different objects of study**, that every map is an argument with a projection and a purpose, and that borders and regions are made rather than found. The single most useful teaching move in geography is a map with a story: put the same place through two projections or two centuries and ask what changed and why.

## Cross-cutting: how these subjects get taught well

- **Verify names, dates and current classifications** with `subagent_researcher`. Taxonomy moves, ranges change, and the field's vocabulary is precisely the kind of detail a language model fabricates. Give the authority you are following.
- **Diagrams earn their place constantly**: the rock cycle, a cladogram, a cross-section, a food web, a geological column, a timeline of deep time, a drainage basin, a climate diagram. This is the subject family where `subagent_diagram_maker` will be used most.
- **Field knowledge beats list knowledge.** Wherever possible, tie the material to what is around him — the plants in his own walks, the rocks under his own county, the weather he can see. Ask what he noticed; that is both the probe and the motivation.
- **Scale checks are the highest-value check questions in these fields**: "if this timeline is one metre, where is the first human?", "how long would that rate take to move that much?", "which is bigger — the number of species or the number of stars?". Get one wrong and the intuition is missing; get it right and the numbers start to mean something.
