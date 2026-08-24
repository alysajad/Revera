import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from rest_framework.test import APIClient
from django.test import override_settings
from accounts.models import User
from complaints.models import Complaint

@override_settings(ALLOWED_HOSTS=['testserver'])
def run_tests():
    print("Running Complaint Implementation Tests...")
    
    # 1. Create a CRE user
    cre_user, created = User.objects.get_or_create(
        email='cre_test@example.com',
        defaults={'role': User.Role.CRE, 'first_name': 'Test', 'last_name': 'CRE'}
    )
    if created:
        cre_user.set_password('password123')
        cre_user.save()
    
    # 2. Create another user to verify isolation
    admin_user, created = User.objects.get_or_create(
        email='admin_test@example.com',
        defaults={'role': User.Role.ADMIN, 'first_name': 'Test', 'last_name': 'Admin'}
    )
    if created:
        admin_user.set_password('password123')
        admin_user.save()

    client = APIClient()
    
    # Login as CRE
    client.force_authenticate(user=cre_user)
    
    # 3. Test Create Complaint
    payload = {
        "customer_name": "John Doe",
        "customer_phone": "9876543210",
        "category": Complaint.Category.SERVICE_DELAY,
        "priority": Complaint.Priority.HIGH,
        "subject": "Late service",
        "description": "The service was delayed by 2 days.",
        "source": Complaint.Source.PHONE,
    }
    response = client.post('/api/complaints/', payload, content_type='application/json')
    print(f"Create Complaint Status: {response.status_code}")
    if response.status_code == 201:
        print(f"Created Ticket: {response.json().get('ticket_number')}")
        complaint_id = response.json().get('id')
    else:
        print(f"Error: {response.json()}")
        return

    # 4. Test List Complaints (CRE should see only their own)
    response = client.get('/api/complaints/')
    print(f"List Complaints Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"Total Complaints listed for CRE: {data.get('count')}")
    
    # 5. Test Add Note
    note_payload = {"content": "Followed up with customer."}
    response = client.post(f'/api/complaints/{complaint_id}/add-note/', note_payload, content_type='application/json')
    print(f"Add Note Status: {response.status_code}")
    
    # 6. Test Update Complaint (Resolve)
    update_payload = {
        "status": Complaint.Status.RESOLVED,
        "resolution_notes": "Apologized and offered free service."
    }
    response = client.patch(f'/api/complaints/{complaint_id}/', update_payload, content_type='application/json')
    print(f"Update Complaint Status: {response.status_code}")
    
    # 7. Test Analytics
    response = client.get('/api/complaints/analytics/?range=all')
    print(f"Analytics Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"Analytics Summary: {data.get('summary')}")
        print(f"Analytics By Category: {data.get('by_category')}")

if __name__ == '__main__':
    run_tests()
