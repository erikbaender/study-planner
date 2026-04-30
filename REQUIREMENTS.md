# Summary
Create a study planner web app that allows the user to plan a studying schedule for each course and topic using a Gantt chart. The app should offer a good UX on desktop and mobile browsers.

# Features
Users can add add plans at the highest level. Below that, there are courses for each plan. Courses have milestones, for example and example an exam or project deadline. Each milestone can be given a name, notes, and either a single date or a date range. These are added as a list that starts empty, so no milestones are also valid, and so are multiple milestones.
Courses also have a list of topics. Topics are the indivudual parts of the course. Examples of topics could be trigonometry and algebra for a math course. Topics have a name, notes, and can be assigned a list of date ranges. These date ranges will show up as bars in the Gantt chart, and should also be draggable at both ends there to adjust the start and end date. This indicates the range that is planned for studying the topic of that subject. Dependencies can also optionally be added to topics to indicate they depend on one or multiple other topics within that course.

In addition to manually creating and managing plans using the UI, there should also be a feature to import and export plans in a custom json format.

# Design and Interface
Create a clean, minimal interface. Stick closely to Apple's UX and UI design. Allow users to customize courses and topics with a palette of colors. They should also be assigned a random color at creation that has not been used yet. Use the same color palette that Apple provides for this purpose.

# Tech Stack
Use React with Next.js, Typescript, Tailwind, and Ionic for the frontend. Use Convex and TypeScript for the backend. Use pnpm as the package manager. Use OAuth for authentication.

# Reference Data
To see some real data for a study plan, use GitHub access token I provided as a Codespaces secret for this repository. That gives you access to a large amount of issues reflecting a real study plan that was created using the Gantt chart view in GitHub's project feature.

# Implementation planning
You need a good frontend design skill to accomplish the requirements. Research and decide what skill fits the task and your specific capabilities the best. You should also decide what agent settings offer the best chance at a good result.

Do you consider yourself to be the most capable OpenAI model available for the task? And if so, what reasoning level would you choose for an autonomous implementation of the requirements? If not, what other model do you recommend?

Do you recommend running the implementation locally, in the Copilot CLI, or Cloud? What are the benefits and downsides for this task in particular?

Is the current machine configured for this codespace sufficent, or would you benefit from a more powerful configuration?

Make a detailed plan for the implementation. Consider potential issues you might run into along the way. Also consider your development environment and if you are able to get access to everything you need. Ask for all you need from me now. I will provide everything I can, but once you start implementation you need to be able to work on your own.
