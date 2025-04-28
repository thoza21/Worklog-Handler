# test-edit-webhook.ps1

# --- IMPORTANT --- 
# Replace this URL with the actual URL obtained from `forge install --show-triggers` or `forge webtrigger`
$webhookUrl = "https://8821cede-9470-4761-ba54-ad700c17298d.hello.atlassian-dev.net/x1/3rF1MyXPEXz3xJlp0dm2erXMMUM"

# --- OPTIONAL --- 
# Define the secret header (currently NOT validated by the handler)
$secretHeader = @{
    "x-zapier-secret" = "LgJZg00w82nawBYAnMPMaxV1oxubSqMH"
}

# --- USER INPUT --- 
# Replace with the Atlassian Account ID of the user who has authorized the app
$targetUserId = "61518b29198b4f0068ff364a" # Use the same user ID
# Replace with the target Jira issue key where the worklog exists
$targetIssueKey = "COM-114" # Example from user
# Replace with the ID of the worklog you want to EDIT
$targetWorklogId = "10048" # Updated with the ID from the last successful create

# --- WORKLOG DETAILS (EDIT) --- 
$worklogPayload = @{
    event            = "hours:updated"     # Specify the update event
    userId           = $targetUserId
    issueKey         = $targetIssueKey
    worklogId        = $targetWorklogId    # Include the ID of the worklog to edit
    timeSpentSeconds = 900                 # New time (15 minutes)
    # New start time (using format: yyyy-MM-ddTHH:mm:ss.fff+0000)
    started          = ((Get-Date).ToUniversalTime().AddMinutes(-30)).ToString("yyyy-MM-ddTHH:mm:ss.fff") + "+0000" 
}

# Convert the payload object to a JSON string
$payloadJson = $worklogPayload | ConvertTo-Json -Depth 5

# Construct the headers including Content-Type
$headers = $secretHeader
$headers.Add("Content-Type", "application/json")

# Make the POST request using Invoke-RestMethod
Write-Host "Sending POST request to $webhookUrl..."
Write-Host "Payload: $payloadJson"
try {
    $response = Invoke-RestMethod -Uri $webhookUrl -Method Post -Headers $headers -Body $payloadJson -ErrorAction Stop
    Write-Host "Request successful!"
    Write-Host "Response:"
    # Attempt to format the response as JSON if possible
    try {
        $response | ConvertTo-Json -Depth 5 
    } catch {
        Write-Host "(Response was not valid JSON)"
        Write-Host $response
    }
} catch {
    Write-Error "Request failed: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $errorResponse = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($errorResponse)
        $errorBody = $reader.ReadToEnd();
        Write-Host "Error Response Body:"
        # Attempt to format the error as JSON if possible
        try {
            $errorBody | ConvertFrom-Json | ConvertTo-Json -Depth 5
        } catch {
             Write-Host "(Error body was not valid JSON)"
             Write-Host $errorBody
        }
    }
} 