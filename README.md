# Vexifiy

An unofficial companion app for the 2026-27 VEX IQ Robotics Competition game, Level Up. Everything runs on your computer.

- **Ask AI**: plain-language answers about the manual from a local Ollama model, each tied to the rule it came from.
- **Rulebook**: browse and search every rule, with Simple and Referee explanations one click away.
- **Block code**: snap VEX IQ blocks together (drivetrain, motors, sensors, controller, Brain screen, Touch LED) and export VEX IQ (2nd gen) Python for VEXcode IQ. Describe what you want and the AI builds or changes the blocks, or ask it to explain your program. In testing, `phi4:14b` wrote correct programs most often, so it's the default there.
- **Interview**: practice the judges' team interview. From a bank of 82 questions, an AI judge asks Quick (5) or Full (9) questions, scores each answer 0-5 with a tip and a likely follow-up, and suggests which areas to practice. The areas are modeled on what judges look for; the REC Foundation Guide to Judging has the official rubric.
- **Timers**: Teamwork and Skills presets with the 0:35-0:25 driver switch window, drills, and your own multi-segment timers with spoken cues. Like a real field, a start sound plays as the Match begins, the driver switch sounds at 0:35 and 0:25, and the end buzzer is followed by an automatic reset. Use the built-in tournament-style or classic sounds, or put your own recordings in [`sounds/`](sounds/README.md) (ignored by git, so they never get uploaded).
- **3D Field**: orbit the field, click parts for rules and dimensions, and drag Bean Bags onto Goals to test scores.

## Run it

Double-click `Vexifiy.command`, or run:

    npm install
    npm start

Then open http://localhost:4477. Ollama must be running for Ask AI; everything else works without it.

## Keep the manual current

VEX updates the manual through the season (see the schedule inside the manual). The official site blocks automated downloads, so this takes one quick manual step. Open the full manual page at manuals.vex.com (the link is in **Rules > Manual sources**), then either choose **Save as PDF** in the print window and drop the PDF in, or select all the text, copy it, and paste it into the text box there with the version number filled in. The manual text is stored in `data/` and is not part of this repository. For a later version, update `KNOWN_LATEST` in `lib/season-notes.js` so the link and version check stay right.

The app includes short notes checked against manual v2.1 in `lib/season-notes.js`.

## Good to know

- Your manual text and search index are stored in `data/`, on this computer only.
- Any Ollama chat model can be chosen in the app, and an embedding model improves search. To rank models on Level Up questions with known answers, run `node scripts/benchmark-models.js model-a model-b` while Vexifiy is running. The winner becomes the default, unless you've picked a model yourself.
- The 3D models are generated in code from the Appendix A drawings, for learning and strategy. Use the official specifications to build a field. The robot is a generic demo, not a recommended design.
- Run the tests with `npm test`.

Not affiliated with or endorsed by VEX Robotics or the REC Foundation. The manual and the Head Referee are always the final word.
