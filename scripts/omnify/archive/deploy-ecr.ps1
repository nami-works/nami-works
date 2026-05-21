param(
  [string]$Region = "us-east-1",
  [Parameter(Mandatory = $true)][string]$Repository,
  [string]$Tag = "latest"
)

Write-Host "Logging into ECR..."
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $Repository

Write-Host "Building image..."
docker build -t "${Repository}:${Tag}" .

Write-Host "Pushing image..."
docker push "${Repository}:${Tag}"
