#!/bin/bash

# Health check with alerts
check_health() {
    if ! curl -f http://localhost:8080/health > /dev/null 2>&1; then
        echo "🚨 ALERT: KitchZero API is down!"
        # Add notification logic (email, Slack, etc.)
        return 1
    fi
    return 0
}

# Database check
check_database() {
    if ! curl -f http://localhost:8080/health/database > /dev/null 2>&1; then
        echo "🚨 ALERT: Database connection failed!"
        return 1
    fi
    return 0
}

# Log disk usage
check_disk_usage() {
    USAGE=$(df /var/log/kitchzero | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ $USAGE -gt 80 ]; then
        echo "⚠️  WARNING: Log disk usage is ${USAGE}%"
    fi
}

# Run checks
check_health
check_database
check_disk_usage

# Log system stats
echo "📊 System Status: $(date)"
echo "Memory: $(free -h | awk 'NR==2{print $3"/"$2}')"
echo "CPU: $(top -bn1 | grep load | awk '{print $10 $11 $12}')"
echo "Active connections: $(docker exec kitchzero-postgres-prod psql -U $DB_USERNAME -d $DB_NAME -c 'SELECT count(*) FROM pg_stat_activity' -t)"