# test-delete-webhook.ps1

# Configuration - Replace placeholders with your actual values
$webhookUrl = "https://8821cede-9470-4761-ba54-ad700c17298d.hello.atlassian-dev.net/x1/3rF1MyXPEXz3" # Replace with your Forge app's webhook URL
$secretHeader = $null # Optional: Replace with your secret if you configured one in Forge, e.g., "X-Webhook-Secret: YourSecretValue"

# --- You usually only need to change these ---
$targetUserId = "61518b29198b4f0068ff364a" # Replace with the Atlassian Account ID of the user
$targetIssueKey = "COM-114"        # Replace with the Jira issue key
$targetWorklogId = "10049"        # Replace with the ID of the worklog to delete
# ----------------------------------------------

# --- PAYLOAD (DELETE) --- 
$deletePayload = @{
    event            = "hours:deleted"     # Specify the delete event
    userId           = $targetUserId
    issueKey         = $targetIssueKey
    worklogId        = $targetWorklogId    # ID of the worklog to delete
    # started and timeSpentSeconds are not required for delete
}

# Convert the payload object to a JSON string
$payloadJson = $deletePayload | ConvertTo-Json -Depth 5

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