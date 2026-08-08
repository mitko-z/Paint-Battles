# Drawing-Battle
A real-time 1v1 training project where players sketch a prompt in 60 seconds and an AI Vision model judges the winner

# Problem
Who has this pain, how big/frequent
is it:
• Internal: The engineering team lacks a
unified, practical project to master AI
integrations and real-time server sync.
• External: Casual mobile gamers want
quick, creative, and competitive games.
What do they do today instead:
• Internal: Devs rely on dry tutorials or
disconnected mini-tasks.
• External: Users play slow
asynchronous games or time-
consuming multiplayer games.

# Solution
Core idea in plain language:
• A real-time game where matched
players get a random prompt and 1
minute to draw it. An AI evaluates both
sketches and declares the closest match
the winner.
Why this approach solves it:
• It acts as a comprehensive, hands-on
training ground encompassing UI,
WebSockets, AI APIs, and DBs, while
also creating a highly engaging product.

# Target users & values
Primary user / buyer:
• Internal development team.
• Casual gamers and friend groups.
Value:
• Risk removed: De-risks future
enterprise AI and real-time sync
projects by building in-house expertise
in a low-stakes environment.
• Time saved: Delivers a complete
competitive game loop in under 2
minutes.

# MVP SCOPE (in / out)
Must-have for v1:
• Real-time 1v1 matchmaking & server
synchronization.
• Mobile-friendly canvas (pen and
eraser).
• Third-party AI Vision API integration
for scoring.
• Basic profiles with win/loss records.
Explicitly OUT of scope for v1:
• Complex Elo-based ranking ladders.
• Monetization, ads, or in-app
purchases.
• Social features (friends lists, chat,
avatars).
• Advanced drawing tools (colors,
layers)

# SUCCESS METRIC
• Metric 1: 100 head-to-head matches
completed without server
desynchronization during the internal
beta.
• Metric 2: AI scoring latency remains
under 3 seconds per match.

# KEY ASSUMPTIONS & DEPENDENCIES
What must be true for this to work:
• AI vision models can accurately
evaluate fast, unpolished 1-minute
doodles.
• Real-time sync can be handled
smoothly on typical mobile networks.
External systems/teams/data
needed:
• Cloud hosting infrastructure.
• API key for a commercial AI Vision
model.

