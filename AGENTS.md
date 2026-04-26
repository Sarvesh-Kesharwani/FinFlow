
# Rules to Follow for Every Task

1. After every change, commit the update to the `dev` branch.
2. Never debug application logic until cache/state issues are ruled out
    - Always start development using a clean environment:
    - Kill existing dev server (port 3000)
    - Remove `.next` directory
    - Start server

    - On any unexplained error (especially 500 / Internal Server Error):
    - Perform an automatic clean restart:
        1. Stop server
        2. Delete `.next`
        3. Restart server
        4. Verify critical routes return 200

    - Treat `.next` cache as non-trustworthy; reset it proactively when instability is detected
3. after each response, tell me the total no of tokens i get every 5hrs, no of tokens used in this task, and remaining tokens.   