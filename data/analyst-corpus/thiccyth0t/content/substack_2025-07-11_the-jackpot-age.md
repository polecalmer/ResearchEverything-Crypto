---
source: substack
author: thiccyth0t
date: 2025-07-11
url: https://www.scimitar.capital/p/the-jackpot-age
title: the jackpot age
type: article
---

[![](https://substackcdn.com/image/fetch/$s_!fRuG!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5bd56de9-c5d2-404a-93f0-0700fa584eb5_2560x1735.jpeg)](<https://substackcdn.com/image/fetch/$s_!fRuG!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5bd56de9-c5d2-404a-93f0-0700fa584eb5_2560x1735.jpeg>)The Course of Empire: Consummation by Thomas Cole

This essay is about shifts in risk taking towards the worship of jackpots and its broader societal implications. There is some light math but it will be worth it to read to the end. 

Imagine you are presented with this coin flip game. How many times do you flip it?

[![](https://substackcdn.com/image/fetch/$s_!CHIX!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F51d695f1-62f4-45b1-8bb3-abf49b6416ea_1162x932.png)](<https://substackcdn.com/image/fetch/$s_!CHIX!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F51d695f1-62f4-45b1-8bb3-abf49b6416ea_1162x932.png>)

At first glance the game feels like a money printer. The coin flip has positive expected value of twenty percent of your net worth per flip so you should flip the coin infinitely and eventually accumulate all of the wealth in the world. 

However, If we [simulate](<https://github.com/alexjchen00/jackpot-hunting/tree/main>) twenty-five thousand people flipping this coin a thousand times, virtually all of them end up with approximately 0 dollars. 

[![](https://substackcdn.com/image/fetch/$s_!Gdpq!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F372c57f9-41c2-4d09-9fde-9800f1ed548f_724x568.png)](<https://substackcdn.com/image/fetch/$s_!Gdpq!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F372c57f9-41c2-4d09-9fde-9800f1ed548f_724x568.png>)

The reason almost all outcomes go to zero is because of the multiplicative property of this repeated coin flip. Even though the **expected value** aka the **arithmetic mean** of the game is positive at a twenty percent gain per flip, the **[geometric mean](<https://en.wikipedia.org/wiki/Geometric_mean>)**[ ](<https://en.wikipedia.org/wiki/Geometric_mean>)is negative, meaning that the coin flip is actually negatively compounding over the long run. 

[![](https://substackcdn.com/image/fetch/$s_!W5D5!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fda875240-1d19-4892-8cc2-75a7d3241dd9_1162x524.png)](<https://substackcdn.com/image/fetch/$s_!W5D5!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fda875240-1d19-4892-8cc2-75a7d3241dd9_1162x524.png>)

How can this be? Here's an intuitive way to think about it:

The **arithmetic mean** measures the average wealth created by all possible outcomes. In our coin flip game the wealth is **heavily skewed towards rare jackpot scenarios**. The **geometric mean** measures the wealth you'd expect in the **median outcome**. 

The simulation above illustrates the difference. Almost all paths bleed to zero. You need to flip **570 heads and 430 tails** just to break even in this game. After 1,000 flips, **all of the expected value** is concentrated in just **0.0001% of jackpot outcomes** , the extremely rare case where you flip a lot of heads. 

The discrepancy between arithmetic and geometric means forms what I call the **Jackpot Paradox**. Physicists call it the [ergodicity problem](<https://ergodicityeconomics.com/>) and traders call it [volatility drag](<https://aptuscapitaladvisors.com/leveraged-etfs-the-hidden-costs-of-volatility-drag/>). You can’t always eat the expected value when it’s squirreled away in rare jackpots. Risk too much hunting jackpots and the volatility will turn positive expected value into a straight line to zero. **In the world of compounded returns, the dose makes the poison.**

Crypto culture in the early 20s was a living example of the Jackpot Paradox. SBF started the conversation in a [tweet](<https://x.com/SBF_FTX/status/1337250686870831107>) about **wealth preferences** _._

  * **Log wealth preference:** every dollar is less valuable than the dollar before it and your appetite for risk shrinks as your bankroll grows.

  * **Linear wealth preference:** every dollar is valued identically and keep the same risk appetite no matter how much you’ve already made.




[![](https://substackcdn.com/image/fetch/$s_!XL8K!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F77eea326-116d-4c68-bc0e-fd92108b794e_990x288.png)](<https://substackcdn.com/image/fetch/$s_!XL8K!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F77eea326-116d-4c68-bc0e-fd92108b794e_990x288.png>)

SBF proudly proclaimed that he had a linear wealth preference. Since he aimed to donate everything, he argued that doubling from $10 billion to $20 billion mattered just as much as going from $0 to $10 billion, so swinging for huge, risky bets were logically worth it from the perspective of civilization. 

[Su Zhu of Three Arrows Capital](<https://x.com/zhusu/status/1448980298193010688>) echoed this preference for linear wealth and even took it a step further in introducing the **exponential wealth preference**. 

[![](https://substackcdn.com/image/fetch/$s_!1RVg!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6a117c48-6007-4a89-817b-9b122c40c5ea_474x434.png)](<https://substackcdn.com/image/fetch/$s_!1RVg!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6a117c48-6007-4a89-817b-9b122c40c5ea_474x434.png>)

  * **Exponential wealth preference:** every new dollar feels more valuable than the last, so you dial **up** risk as your bankroll grows and happily pay a premium for jackpots.




Here’s how the three wealth preferences map to our coin flip game from above. 

[![](https://substackcdn.com/image/fetch/$s_!ARtJ!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F3781ea33-956e-4999-a5d4-f96e91c207c2_1186x746.png)](<https://substackcdn.com/image/fetch/$s_!ARtJ!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F3781ea33-956e-4999-a5d4-f96e91c207c2_1186x746.png>)

Given our understanding of the Jackpot Paradox, it’s obvious that SBF and 3AC were figuratively flipping this coin infinitely. That mindset was how they built their fortunes in the first place. Equally unsurprising and obvious in hindsight was that [SBF](<https://en.wikipedia.org/wiki/Sam_Bankman-Fried>) and [3AC](<https://en.wikipedia.org/wiki/Three_Arrows_Capital>) both ended up vaporizing ten billion dollars. Perhaps they are quintillionaires in a distant parallel universe which justifies the risks they took. 

These blowups aren’t just cautionary parables about the mathematics of risk management, but rather a reflection of a deeper **macrocultural shift toward linear and even exponential wealth preferences.**

Founders are expected to adopt a linear wealth mindset and take big risks that maximize expected value as cogs in the venture capital machine dependent on [power law home runs](<https://cdixon.org/2015/06/07/the-babe-ruth-effect-in-venture-capital>). The tales of Elon Musk, Jeff Bezos, and Mark Zuckerberg risking everything they had and emerging with the largest personal fortunes on planet Earth reinforce the mythos that drives the entire risk taking sector, while survivorship bias conveniently forgets the millions of founders who go to zero. Salvation comes only to the select few who clear an ever steepening power law threshold. 

That taste for outsized risk has seeped into everyday culture. Wage growth has severely lagged compounded capital, causing ordinary people to increasingly see their best shot at real upward mobility in negative EV jackpots. Online gambling, 0DTE options, retail meme stocks, sports betting, and crypto memecoins all testify to the phenomena of exponential wealth preference. Technology makes speculating effortless, while social media spreads the story of each new overnight millionaire, luring the broader population into one giant losing bet like moths to a light. 

**We’re becoming a culture that worships the jackpot and increasingly prices survival at zero.**

And AI exacerbates the trend by further devaluing labor and intensifying winner take all outcomes. The techno-optimist dream of an abundant post-AGI world where humans devote their days to art and leisure will look more like billions of people chasing negative sum capital and status jackpots with UBI stipends. Perhaps the up only [e/acc logo](<https://en.wikipedia.org/wiki/Effective_accelerationism>) should be redrawn to reflect the blizzard of paths that bleed to zero along the way, **the true silhouette of the Jackpot Age.**

[![](https://substackcdn.com/image/fetch/$s_!ZoxK!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe516e3bb-dfc5-4bbd-ba60-f4b3339232a1_6175x3361.png)](<https://substackcdn.com/image/fetch/$s_!ZoxK!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe516e3bb-dfc5-4bbd-ba60-f4b3339232a1_6175x3361.png>)

In its most extreme form, capitalism behaves like a collectivist hive. The Jackpot Paradox math says it’s rational for civilization to treat humanity as interchangeable labor, sacrificing millions of worker bees to maximize the linear expected value for the colony. That might be the most efficient for aggregate growth, but it **distributes purpose and meaning miserably.**

[Marc Andreessen’s techno-optimist manifesto](<https://a16z.com/the-techno-optimist-manifesto/>) warns that “man was not meant to be farmed; man was meant to be **useful** , to be **productive** , to be **proud**.” 

But the rapid acceleration of technology and the shifts towards higher ever more aggressive risk taking incentives have pushed us precisely towards the outcome he warns against. In the Jackpot Age, growth is fueled by farming fellow man. Usefulness, productivity, and pride are increasingly reserved for the privileged few who win the competition. We have boosted the mean at the cost of the median, leaving a widening gap in mobility, status, and dignity that have bred entire economies of negative sum cultural phenomena. The resulting externality shows up as social unrest, starting with the election of demagogues and ending with violent revolution, which can be quite costly to [civilizational compounded growth](<https://www.astralcodexten.com/p/kelly-bets-on-civilization>). 

[![](https://substackcdn.com/image/fetch/$s_!yakb!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcc807e0f-1a1c-44cd-a83a-31da34e7518c_8917x5532.jpeg)](<https://substackcdn.com/image/fetch/$s_!yakb!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcc807e0f-1a1c-44cd-a83a-31da34e7518c_8917x5532.jpeg>)

Having made a living trading crypto markets, I’ve witnessed the degeneracy and desperation that has arisen from the culture shift firsthand. Much like the jackpot simulation, my victory stands on a pile of a thousand corpses of other traders. A monument to wasted human potential. 

When people in the industry come to me for trading advice I almost always spot the same pattern. They all risk too much and drawdown too deep. Underneath there is typically a scarcity mindset driving it, a gnawing sense of feeling “behind” where they should be and a compulsion to make it fast. 

My answer is always the same. **build more edge rather than risk more size**. Don’t kill yourself chasing the jackpot. Log wealth is what matters. Maximize the 50th percentile outcome. Make your own luck. Avoid drawdowns. Eventually you will get there. 

[![](https://substackcdn.com/image/fetch/$s_!QD-P!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe3040b64-fdf0-4a4c-bf3b-f6b5ad5ffede_952x216.webp)](<https://substackcdn.com/image/fetch/$s_!QD-P!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe3040b64-fdf0-4a4c-bf3b-f6b5ad5ffede_952x216.webp>)

But most people will not ever generate consistent edge. “Just win more” isn’t scalable advice. In the technocapitalist rat race, meaning and purpose is ever more winner takes all. It brings us back to meaning. Perhaps what we need is some sort of [second coming of religion](<https://zhukeepa.substack.com/p/ai-alignment-and-the-distributed>) that reconciles old spiritual teachings with the realities of modern technology. 

Christianity once scaled because it promised salvation to anyone. Buddhism spread on the claim that anyone could reach enlightenment. 

**A modern analog would have to do the same in offering dignity, purpose, and an alternative path forward for all people so they don’t destroy themselves chasing jackpots.**

[![](https://substackcdn.com/image/fetch/$s_!ymn2!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F0a3ecf94-ecc0-4dab-9a31-19e073f3c431_8881x5526.jpeg)](<https://substackcdn.com/image/fetch/$s_!ymn2!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F0a3ecf94-ecc0-4dab-9a31-19e073f3c431_8881x5526.jpeg>)

Thanks to my friends [Alex](<https://x.com/trippingvols>), [Chris](<https://x.com/ChrisChipMonk>), [Sean](<https://x.com/sean_geiger>), [Cass](<https://x.com/PlowmanCass>), and [Yung Macro](<https://x.com/apralky>) for the conversations around this topic. 

[Subscribe now](<https://www.scimitar.capital/subscribe?>)
