#ifndef _CONTRACT_EMPLOYEE_C_
#define _CONTRACT_EMPLOYEE_C_

#include "ContractEmployee.h"

ContractEmployee NewContractEmployee(float hours, float rate, unsigned int contractDuration)
{
	Employee employee = NewEmployee(EMPLOYEE_TYPE_SEASONAL, hours, rate);

	ContractEmployee contractEmployee = { employee, contractDuration };

	return contractEmployee;
}

float CalculateContractPayroll(ContractEmployee employee, unsigned int * error)
{
	*error = FALSE_L;

	if (employee.contractDuration <= 0
		|| employee.employee.rate < 0)
	{
		*error = TRUE_L;
		return -1;
	}

	return employee.employee.rate / employee.contractDuration;
}

#endif // !_CONTRACT_EMPLOYEE_C_