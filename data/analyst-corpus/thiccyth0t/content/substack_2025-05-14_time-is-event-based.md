---
source: substack
author: thiccyth0t
date: 2025-05-14
url: https://www.scimitar.capital/p/time-is-event-based
title: time is event based
type: article
---

[![](https://substackcdn.com/image/fetch/$s_!8n01!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5ac9574e-bb79-4614-acd1-656a6fd3d1fa_750x449.jpeg)](<https://substackcdn.com/image/fetch/$s_!8n01!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5ac9574e-bb79-4614-acd1-656a6fd3d1fa_750x449.jpeg>)Haystacks, Monet

After college I worked for a high frequency trading firm where the basic unit of time was the microsecond. A single blink—about 250,000 µs—was long enough for our algorithms to open and close thousands of positions, each trade born and buried long before a human observer would have even noticed the screen had changed.

At the end of each day we would grade our trading by looking forward into the future for every trade. If we bought stock A at $5.00, we would have liked to see the market trading at $5.01 moments later. 

We didn’t use many time-based benchmarks. Ten seconds for a stock like NVDA was an eternity compared to a no-name stock. Thousands of individual trades could have been entered and exited in NVDA in the time it took the no-name stock to update it’s price a single time. There were levels to this eye blinking metaphor.

[![Output image](https://substackcdn.com/image/fetch/$s_!Bqnm!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F920ef15a-5a10-4d97-b42e-30a83f9a74cb_1779x979.bin)](<https://substackcdn.com/image/fetch/$s_!Bqnm!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F920ef15a-5a10-4d97-b42e-30a83f9a74cb_1779x979.bin>)random data i generated

We used event benchmarks instead of time benchmarks. Every time someone executed a trade, cancelled a bid, updated an offer, was counted an event. Any change in the state of the order book reflected someone pricing in new information about the world. We would then benchmark our trading to the market price say 1000 events in the future. For some stocks, this would be milliseconds. For others, minutes. This normalized our performance benchmarks across all different types of stocks and made us more effective in generalizing our strategies. 

**It was my first lesson that event based time perception mattered more than objective time.**

[![](https://substackcdn.com/image/fetch/$s_!TZY5!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F1ffb74d7-62f8-4d00-ab3f-de391ac6a773_1200x851.jpeg)](<https://substackcdn.com/image/fetch/$s_!TZY5!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F1ffb74d7-62f8-4d00-ab3f-de391ac6a773_1200x851.jpeg>)

This concept carried with me as I left HFT and moved into crypto discretionary trading. Crypto is the only market that trades 24/7, meaning there simply was no rest for the wicked. The game was less about brilliance and more about being awake when it counted. Resource management around attention and waking hours was a big part of the game. I quickly learned there were only a few important hours that I needed to be awake. 

[![Output image](https://substackcdn.com/image/fetch/$s_!XSm0!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd14b6b28-1bcd-440b-b9c1-5ff464cbee1d_2180x380.bin)](<https://substackcdn.com/image/fetch/$s_!XSm0!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd14b6b28-1bcd-440b-b9c1-5ff464cbee1d_2180x380.bin>)

Pretty quickly I mapped the day’s “hot zones”:

  * **7 – 11 am ET** US open

  * **3 – 4 pm** US Close

  * **4 – 5 pm** After-hours headline dump

  * **7 – 8 pm** Quants rebalance at 0 UTC

  * **9 – 11 pm** Korean retail pumps altcoins

  * **4 – 7 am** Euros position for US open




Everything outside those windows was mostly noise. Weeks where nothing happened followed by a single headline turned into minutes where weeks happened.

[![No photo description available.](https://substackcdn.com/image/fetch/$s_!-hq_!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff137bb4b-8d11-4fac-94f0-c6d17c249604_850x400.jpeg)](<https://substackcdn.com/image/fetch/$s_!-hq_!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff137bb4b-8d11-4fac-94f0-c6d17c249604_850x400.jpeg>)

My cofounder and I developed a polyphasic sleeping routine so that we would be conscious during as many of these action periods as possible. It was rare to get uninterrupted sleep for more than 3 hours at a time. We took tactical naps whenever possible and had phone alarms to wake us up in case important headlines came out during off hours. I felt like I had experienced three days for every one that passed. 

There was always something going on. Everyday a new puzzle to solve. A new fire to put out. We frequently would work 18 hour days processing information, trading events, building infrastructure, and managing risk. We frequently moved around different parts of the world, built strong relationships with all sorts of people from around the globe, and experienced some of the highest highs and lowest lows of our lives. 

**Those three years felt like the longest stretch I’ve ever lived.**

[![](https://substackcdn.com/image/fetch/$s_!-v2O!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe7527eac-c753-4665-8609-fd8f108a5e25_750x594.jpeg)](<https://substackcdn.com/image/fetch/$s_!-v2O!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe7527eac-c753-4665-8609-fd8f108a5e25_750x594.jpeg>)

Most of my friends say the opposite that these same three years flashed by. French philosopher Paul Janet’s old ratio-of-life idea explains the gap: at ten, a year is a tenth of your entire memory bank, but by fifty it’s only two percent. **By twenty-two you’ve already “spent” half your subjective lifetime** , so unless you cram it with fresh events, each new calendar year keeps shrinking.

[![Output image](https://substackcdn.com/image/fetch/$s_!1p2z!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2ea1eec8-998e-42db-acc7-6f5729b23e4b_1380x780.bin)](<https://substackcdn.com/image/fetch/$s_!1p2z!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2ea1eec8-998e-42db-acc7-6f5729b23e4b_1380x780.bin>)

**This subjective time dilation adds another vector of inevitable decay to the human experience.** Not only does wealth erode from inflation and the body deteriorates from age, but even time contracts from perception, **compressing each passing year into a smaller and faster blur.** Yes, packing a life with novelty can stretch your years, but that familiar sermon can stay on the shelf. 

[![](https://substackcdn.com/image/fetch/$s_!apP1!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa2722df6-6aba-49f1-a947-90503cf5b641_1200x630.jpeg)](<https://substackcdn.com/image/fetch/$s_!apP1!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa2722df6-6aba-49f1-a947-90503cf5b641_1200x630.jpeg>)

What is striking is the **asymmetry between the experience of the individual and the collective**. The individual experiences subjective time contraction with each passing year while **the collective experiences subjective time expansion.** Every year is increasingly more eventful within the context of human history than the last with an exponential acceleration in the last three centuries. What has caused the expansion of time for the collective?

[![](https://substackcdn.com/image/fetch/$s_!mbMc!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6ce12f6b-4aec-4804-939a-2fa8de9a504f_790x481.jpeg)](<https://substackcdn.com/image/fetch/$s_!mbMc!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6ce12f6b-4aec-4804-939a-2fa8de9a504f_790x481.jpeg>)

Transposing human history in an **event-based vector space** makes it easier to understand. **We define an event as one “life-year” or one person being alive for one calendar year.1** Add them up and you get a sum of how much “human consciousness” the planet has ever generated, totaling a little over 1.6 trillion life-years. 

Human population didn’t start to explode until agriculture launched a feedback loop starting around 5000 BC. Surplus energy fed population growth, which freed up specialists who made discoveries that multiplied energy again, tightening the cycle until humanity’s doubling time fell from millennia to centuries to mere decades post industrial revolution.

I charted the cumulative total of human life years by anchoring on known population figures from public datasets and linearly interpolated the gaps without introducing any assumptions about average lifespan (code below if you want to tweak the anchors).2

[![](https://substackcdn.com/image/fetch/$s_!26wN!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7494fd68-1be2-417d-bb5a-d5170160ba51_1980x780.jpeg)](<https://substackcdn.com/image/fetch/$s_!26wN!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7494fd68-1be2-417d-bb5a-d5170160ba51_1980x780.jpeg>)

While the individual experiences time on a log scale, the collective has experienced time on an exponential scale, **with almost eighty percent of human experience occurring in the last three millenia.**

Zoom in and the view is even more extreme. 

  * 50% of all lived human experience occurs after 1500 CE

  * 25% occurs after 1945 CE

  * 10% occurs after 2003 CE




[![](https://substackcdn.com/image/fetch/$s_!Kjo1!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa3884a50-754e-4e5e-bcbf-e99a8fada293_1971x780.jpeg)](<https://substackcdn.com/image/fetch/$s_!Kjo1!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa3884a50-754e-4e5e-bcbf-e99a8fada293_1971x780.jpeg>)

Even as global population is projected to top at ~10 billion 2080 as birthrates from developed nations naturally slow, there is still twenty five percent of all human experience that will be lived over the next 50 years. **Every subsequent calendar year accounts for roughly 0.50% of all human experience.**

[![](https://substackcdn.com/image/fetch/$s_!IxB9!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F36dfcb91-2c9b-4a93-a6e4-9076a77ea54f_1280x634.jpeg)](<https://substackcdn.com/image/fetch/$s_!IxB9!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F36dfcb91-2c9b-4a93-a6e4-9076a77ea54f_1280x634.jpeg>)

[![](https://substackcdn.com/image/fetch/$s_!OO_f!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F29573abf-49d5-4780-be38-cd813fd26bde_1280x634.jpeg)](<https://substackcdn.com/image/fetch/$s_!OO_f!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F29573abf-49d5-4780-be38-cd813fd26bde_1280x634.jpeg>)

The acceleration makes sense once you normalize by life-years, not by centuries. It’s one more “truth fractal” I keep bumping into: the idea that **time is better counted in events than in objective time** shows up in my day to day trading, stretches across an individual lifetime, and scales to the whole span of human history.

[![](https://substackcdn.com/image/fetch/$s_!7VxD!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd26b56b2-4647-45df-ac1c-109bdc4c9672_400x286.png)](<https://substackcdn.com/image/fetch/$s_!7VxD!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd26b56b2-4647-45df-ac1c-109bdc4c9672_400x286.png>)

There’s plenty more of these fractals are out there. I’ll dig into them in future articles. Thanks for reading.

[Subscribe now](<https://www.scimitar.capital/subscribe?>)

1

<https://www.lesswrong.com/posts/SwBEJapZNzWFifLN6/the-funnel-of-human-experience>

2

<https://github.com/alexjchen00/lifeyears>
