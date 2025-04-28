# test-webhook.ps1

# --- IMPORTANT --- 
# Replace this URL with the actual URL obtained from `forge install --show-triggers` or `forge webtrigger`
$webhookUrl = "https://8821cede-9470-4761-ba54-ad700c17298d.hello.atlassian-dev.net/x1/3rF1MyXPEXz3xJlp0dm2erXMMUM"

# --- OPTIONAL --- 
# Define the secret header (currently NOT validated by the handler)
# If you implement secret validation, ensure this matches the stored secret.
$secretHeader = @{
    "x-zapier-secret" = "LgJZg00w82nawBYAnMPMaxV1oxubSqMH"
}

# --- USER INPUT --- 
# Replace with the Atlassian Account ID of the user who has authorized the app
$targetUserId = "61518b29198b4f0068ff364a"
# Replace with the target Jira issue key
$targetIssueKey = "COM-114" 

# --- WORKLOG DETAILS (CREATE) --- 
$worklogPayload = @{
    event            = "hours:created"     # Add the event type
    userId           = $targetUserId       # Changed from userAccountId to userId
    issueKey         = $targetIssueKey     # Use variable
    timeSpentSeconds = 3600                # Example: 1 hour
    # Format date to UTC and then append the required +0000 timezone offset
    started          = ((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff")) + "+0000" 
    # comment        = "Removed for now, as handler doesn't process it yet" # Removed comment field
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