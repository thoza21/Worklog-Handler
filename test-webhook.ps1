# test-webhook.ps1

# --- IMPORTANT --- 
# Replace this URL with the actual URL obtained from `forge install --show-triggers` or `forge webtrigger`
$webhookUrl = "https://a8de7690-6599-485e-ada7-acceda2fd795.hello.atlassian-dev.net/x1/qGxP9ZD3p1TaFS5YBdLbhB8KAVE"

# --- OPTIONAL --- 
# Define the secret header (currently NOT validated by the handler)
# If you implement secret validation, ensure this matches the stored secret.
$secretHeader = @{
    "x-zapier-secret" = "TiiWqns2i2ouIAxx8ROjfFGuh9wr03vM"
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

# Make the POST request using Invoke-WebRequest for more control
Write-Host "Sending POST request to $webhookUrl..."
Write-Host "Payload: $payloadJson"
try {
    # Use Invoke-WebRequest and don't stop on non-2xx responses initially
    $response = Invoke-WebRequest -Uri $webhookUrl -Method Post -Headers $headers -Body $payloadJson # -ErrorAction Stop removed

    # Explicitly check the status code
    if ($response.StatusCode -eq 200) {
        Write-Host "Request successful! (Status Code: $($response.StatusCode))"
        Write-Host "Response Body:"
        # Response body is in the Content property
        try {
            # Attempt to parse and re-format as JSON
            $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5
        } catch {
            Write-Host "(Response body was not valid JSON or parsing failed)"
            Write-Host $response.Content
        }
    } else {
        # Handle non-200 responses as errors
        Write-Error "Request failed! (Status Code: $($response.StatusCode))"
        Write-Host "Error Response Body:"
        Write-Host $response.Content
    }

} catch {
    # Catch other errors (network issues, invalid URL, etc.)
    Write-Error "An unexpected error occurred: $($_.Exception.Message)"
    # Optional: Log more details from $_ if needed
    # Write-Host $_.Exception
} 